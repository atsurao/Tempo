import { describe, expect, it } from "vitest";
import type { Item } from "../types";
import {
  buildRRuleString,
  describeRecurrenceShort,
  expandRecurrence,
  nextOccurrence,
  recurrenceFormOf,
  untilBefore,
} from "./recurrence";
import { buildOccurrences } from "./occurrences";

const at = (day: number, hour = 9, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

const base = (patch: Partial<Item>): Item => ({
  id: "a",
  type: "event",
  title: "Test",
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

describe("expandRecurrence", () => {
  it("expands a weekly rule across the requested week", () => {
    const item = base({
      start: at(12),
      end: at(12, 10),
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
    });
    const instances = expandRecurrence(item, at(12, 0), at(18, 23));
    expect(instances).toHaveLength(3);
    expect(instances.map((i) => new Date(i.start).getDay())).toEqual([1, 3, 5]);
    expect(instances.every((i) => i.end - i.start === 3_600_000)).toBe(true);
  });

  it("respects COUNT", () => {
    const item = base({
      start: at(12),
      end: at(12, 10),
      recurrence: { rrule: "FREQ=DAILY;COUNT=3" },
    });
    const instances = expandRecurrence(item, at(1), at(31, 23));
    expect(instances).toHaveLength(3);
  });

  it("keeps wall-clock time across a DST boundary", () => {
    // US DST ends Nov 1 2026 (clocks fall back on the 1st).
    const start = new Date(2026, 9, 26, 9, 0).getTime();
    const item = base({
      start,
      end: start + 3_600_000,
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO" },
    });
    const instances = expandRecurrence(
      item,
      new Date(2026, 9, 26).getTime(),
      new Date(2026, 10, 16, 23).getTime(),
    );
    expect(instances).toHaveLength(4);
    for (const inst of instances) {
      const d = new Date(inst.start);
      expect(d.getHours()).toBe(9);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it("returns nothing for an invalid rule", () => {
    const item = base({ start: at(12), recurrence: { rrule: "NOT_A_RULE" } });
    expect(expandRecurrence(item, at(1), at(31))).toEqual([]);
  });
});

describe("nextOccurrence", () => {
  it("finds the next weekly instance", () => {
    const item = base({
      start: at(12),
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
    });
    const next = nextOccurrence(item, at(12, 10));
    expect(new Date(next!).getDay()).toBe(3);
    expect(new Date(next!).getDate()).toBe(14);
  });
});

describe("rule builders", () => {
  it("round-trips weekly rules", () => {
    const rrule = buildRRuleString({
      freq: "WEEKLY",
      interval: 2,
      byDay: ["MO", "TH"],
      end: { type: "never" },
    });
    expect(rrule).toContain("FREQ=WEEKLY");
    expect(rrule).toContain("INTERVAL=2");
    const form = recurrenceFormOf(rrule);
    expect(form.freq).toBe("WEEKLY");
    expect(form.interval).toBe(2);
    expect(form.byDay).toEqual(["MO", "TH"]);
  });

  it("encodes an end date", () => {
    const rrule = buildRRuleString({
      freq: "DAILY",
      interval: 1,
      byDay: [],
      end: { type: "on", date: new Date(2026, 9, 30, 23, 59).getTime() },
    });
    expect(rrule).toMatch(/UNTIL=\d{8}T\d{6}Z/);
  });
});

describe("describeRecurrenceShort", () => {
  it("reads the rule's weekday codes as words", () => {
    expect(describeRecurrenceShort("FREQ=WEEKLY;BYDAY=SU")).toBe("Weekly on Sun");
    expect(describeRecurrenceShort("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe(
      "Weekly on Mon, Wed, Fri",
    );
  });

  it("lists the days in week order whatever order they were picked in", () => {
    expect(describeRecurrenceShort("FREQ=WEEKLY;BYDAY=FR,SU,MO")).toBe(
      "Weekly on Mon, Fri, Sun",
    );
  });

  it("never prints a bare two-letter code", () => {
    const rules = [
      "FREQ=WEEKLY;BYDAY=SU",
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
      "FREQ=WEEKLY;BYDAY=SA;COUNT=4",
      "FREQ=WEEKLY;BYDAY=TH;UNTIL=20261130T235959Z",
      "FREQ=DAILY",
      "FREQ=MONTHLY",
      "FREQ=YEARLY",
      "",
      null,
    ];
    for (const rule of rules) {
      expect(describeRecurrenceShort(rule)).not.toMatch(/\b(MO|TU|WE|TH|FR|SA|SU)\b/);
    }
  });

  it("keeps the frequency and end condition", () => {
    expect(describeRecurrenceShort(null)).toBe("Does not repeat");
    expect(describeRecurrenceShort("FREQ=DAILY")).toBe("Daily");
    expect(describeRecurrenceShort("FREQ=WEEKLY;BYDAY=SU;COUNT=3")).toBe(
      "Weekly on Sun · 3 times",
    );
    const until = describeRecurrenceShort("FREQ=WEEKLY;BYDAY=TH;UNTIL=20261130T235959Z");
    expect(until).toContain("Weekly on Thu · until");
  });
});

describe("buildOccurrences", () => {
  const master = base({
    id: "master",
    start: at(12),
    end: at(12, 10),
    recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=5" },
  });

  it("replaces a moved instance with its exception", () => {
    const exception = base({
      id: "exc",
      recurrenceParentId: "master",
      originalStart: at(12),
      start: at(12, 11),
      end: at(12, 12),
      recurrence: null,
    });
    const occs = buildOccurrences([master, exception], at(11), at(19));
    expect(occs).toHaveLength(1);
    expect(new Date(occs[0].start).getHours()).toBe(11);
    expect(occs[0].key).toBe(`master@${at(12)}`);
  });

  it("omits a cancelled instance but keeps the series", () => {
    const cancelled = base({
      id: "exc",
      recurrenceParentId: "master",
      originalStart: at(12),
      cancelled: true,
    });
    const occs = buildOccurrences([master, cancelled], at(11), at(28));
    expect(occs).toHaveLength(2);
    expect(occs.every((o) => o.originalStart !== at(12))).toBe(true);
  });

  it("draws a task due marker when it has no block", () => {
    const task = base({
      id: "t1",
      type: "task",
      dueAt: at(14, 23, 59),
      start: null,
      end: null,
    });
    const occs = buildOccurrences([task], at(11), at(19));
    expect(occs).toHaveLength(1);
    expect(occs[0].isDue).toBe(true);
    expect(occs[0].item.type).toBe("task");
  });

  it("ignores deleted items", () => {
    const deleted = { ...master, id: "gone", deletedAt: Date.now() };
    expect(buildOccurrences([deleted], at(11), at(19))).toHaveLength(0);
  });
});

describe("untilBefore", () => {
  it("stops a series just before the split so both halves never claim it", () => {
    const start = new Date(2026, 9, 12, 9, 0).getTime();
    const master = base({
      start,
      end: start + 3_600_000,
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
    });

    // Split at the Monday Oct 19 instance: the tail takes over from there.
    const splitAt = new Date(2026, 9, 19, 9, 0).getTime();
    const head = { ...master, recurrence: { rrule: `FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=${untilBefore(splitAt)}` } };
    const tail = { ...master, id: "tail", start: splitAt, end: splitAt + 3_600_000 };

    const occs = buildOccurrences([head, tail], at(12, 0), at(25, 23));
    const onSplitDay = occs.filter((o) => o.start === splitAt);
    expect(onSplitDay).toHaveLength(1);
    // the head keeps everything before the split, nothing after
    expect(occs.some((o) => o.start === new Date(2026, 9, 16, 9, 0).getTime())).toBe(true);
    expect(occs.some((o) => o.start === new Date(2026, 9, 23, 9, 0).getTime())).toBe(true);
  });

  it("writes the boundary in local components, not UTC", () => {
    const splitAt = new Date(2026, 9, 19, 9, 0).getTime();
    expect(untilBefore(splitAt)).toBe("20261019T085900Z");
  });
});

describe("buildRRuleString", () => {
  it("ends a rule at the end of the chosen local day", () => {
    const end = new Date(2026, 9, 21, 0, 0).getTime();
    const rrule = buildRRuleString({
      freq: "WEEKLY",
      interval: 1,
      byDay: ["MO"],
      end: { type: "on", date: end },
    });
    expect(rrule).toBe("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261021T235959Z");

    // Mon/Wed/Fri from Mon Oct 19, ending on Wed Oct 21: the end day is
    // included, the following Friday is not.
    const item = base({
      start: new Date(2026, 9, 19, 9, 0).getTime(),
      end: new Date(2026, 9, 19, 10, 0).getTime(),
      recurrence: {
        rrule: buildRRuleString({
          freq: "WEEKLY",
          interval: 1,
          byDay: ["MO", "WE", "FR"],
          end: { type: "on", date: end },
        }),
      },
    });
    const starts = expandRecurrence(item, at(1), new Date(2026, 10, 30).getTime()).map(
      (i) => i.start,
    );
    expect(starts).toEqual([
      new Date(2026, 9, 19, 9, 0).getTime(),
      new Date(2026, 9, 21, 9, 0).getTime(),
    ]);
  });
});
