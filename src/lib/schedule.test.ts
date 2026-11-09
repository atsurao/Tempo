import { describe, expect, it } from "vitest";
import { DAY, sod } from "./date";
import {
  breakDays,
  breakDaysInTerm,
  breakDaysLabel,
  breakRangeLabel,
  breaksByMonth,
  breaksOf,
  buildScheduleOccurrences,
  clockLabel,
  daysOffInTerm,
  formatClock,
  hiddenScheduleIds,
  nextRunningDay,
  onBreak,
  orderedWeekdays,
  parseClock,
  runsOn,
  scheduleSummary,
  sessionEnd,
  sessionItem,
  sessionsOf,
  termBreakSpans,
  termDays,
  termMonths,
  termRangeLabel,
  visibleSchedules,
  type Timetable,
} from "./schedule";
import type {
  Schedule,
  ScheduleBreak,
  ScheduleException,
  ScheduleItem,
} from "../types";

/** Monday 5 October 2026, and the weeks around it. */
const monday = new Date(2026, 9, 5).getTime();
/**
 * `n` days on from that Monday, by calendar date. Millisecond arithmetic would
 * drift across the end of daylight saving, which October and November straddle.
 */
const day = (n: number) => new Date(2026, 9, 5 + n).getTime();

const schedule: Schedule = {
  id: "s1",
  name: "Fall 2026",
  color: "#4f46e5",
  order: 0,
  // A term that starts with the first Monday of the fixture and runs four weeks.
  from: monday,
  to: sod(monday + 27 * DAY),
  createdAt: 0,
  updatedAt: 0,
};

function session(extra: Partial<ScheduleItem> & { days: number[] }): ScheduleItem {
  return {
    id: "si1",
    scheduleId: "s1",
    name: "BIO 201 — Lecture",
    startMin: 9 * 60,
    endMin: 10 * 60 + 15,
    location: "Science Hall 2B",
    order: 0,
    ...extra,
  };
}

function timetable(extra: Partial<Timetable> = {}): Timetable {
  return { schedules: [schedule], items: [session({ days: [1, 3, 5] })], breaks: [], ...extra };
}

const span = (from: number, days: number) => ({ from, to: from + days * DAY - 1 });

describe("buildScheduleOccurrences", () => {
  it("puts one occurrence on each of the session's weekdays", () => {
    const out = buildScheduleOccurrences(timetable(), ...Object.values(span(monday, 7)) as [number, number]);
    expect(out.map((o) => new Date(o.start).getDay())).toEqual([1, 3, 5]);
    expect(out[0].start).toBe(monday + 9 * 60 * 60_000);
    expect(out[0].end).toBe(monday + (10 * 60 + 15) * 60_000);
  });

  it("dresses each one as an event in the schedule's colour", () => {
    const out = buildScheduleOccurrences(timetable(), monday, monday + DAY - 1);
    expect(out[0].item.title).toBe("BIO 201 — Lecture");
    expect(out[0].item.location).toBe("Science Hall 2B");
    expect(out[0].item.color).toBe("#4f46e5");
    expect(out[0].item.type).toBe("event");
    expect(out[0].scheduleId).toBe("s1");
    expect(out[0].isDue).toBeUndefined();
  });

  it("keys each occurrence by session and day, so weeks do not collide", () => {
    const out = buildScheduleOccurrences(timetable(), monday, monday + 14 * DAY);
    expect(new Set(out.map((o) => o.key)).size).toBe(out.length);
    expect(out[0].key).toBe("sched:si1@" + monday);
  });

  it("skips the days a break covers, both ends included", () => {
    const breaks: ScheduleBreak[] = [
      {
        id: "b1",
        scheduleId: "s1",
        label: "Reading week",
        from: sod(monday + 2 * DAY),
        to: sod(monday + 6 * DAY),
      },
    ];
    const out = buildScheduleOccurrences(timetable({ breaks }), monday, monday + 7 * DAY - 1);
    // Monday before the break runs; Wednesday and Friday are inside it.
    expect(out.map((o) => new Date(o.start).getDay())).toEqual([1]);
    const next = buildScheduleOccurrences(timetable({ breaks }), monday + 7 * DAY, monday + 14 * DAY - 1);
    expect(next.map((o) => new Date(o.start).getDay())).toEqual([1, 3, 5]);
  });

  it("treats a one-day break as that day only", () => {
    const breaks: ScheduleBreak[] = [
      { id: "b1", scheduleId: "s1", label: "Holiday", from: sod(monday), to: sod(monday) },
    ];
    const out = buildScheduleOccurrences(timetable({ breaks }), monday, monday + 7 * DAY - 1);
    expect(out.some((o) => o.start === monday + 9 * 60 * 60_000)).toBe(false);
    expect(out.map((o) => new Date(o.start).getDay())).toEqual([3, 5]);
  });

  it("ignores breaks belonging to another schedule", () => {
    const breaks: ScheduleBreak[] = [
      { id: "b1", scheduleId: "other", label: "Reading week", from: sod(monday), to: sod(monday + 30 * DAY) },
    ];
    const out = buildScheduleOccurrences(timetable({ breaks }), monday, monday + 7 * DAY - 1);
    expect(out).toHaveLength(3);
  });

  it("only emits what the window touches", () => {
    const out = buildScheduleOccurrences(timetable(), sod(monday + 2 * DAY), sod(monday + 2 * DAY) + DAY - 1);
    expect(out).toHaveLength(1);
    expect(new Date(out[0].start).getDay()).toBe(3);
  });

  it("drops empty and unknown schedules rather than inventing sessions", () => {
    expect(buildScheduleOccurrences(timetable({ items: [] }), monday, monday + DAY)).toEqual([]);
    expect(buildScheduleOccurrences({ ...timetable(), schedules: [] }, monday, monday + DAY)).toEqual([]);
    const orphan = { ...timetable(), items: [session({ days: [1], scheduleId: "gone" })] };
    expect(buildScheduleOccurrences(orphan, monday, monday + DAY)).toEqual([]);
  });

  it("keeps the same session twice a day when it is listed on that day twice", () => {
    const twice = { ...timetable(), items: [session({ days: [1, 1] })] };
    expect(buildScheduleOccurrences(twice, monday, monday + DAY - 1)).toHaveLength(1);
  });

  it("ignores weekdays outside the calendar week", () => {
    const odd = { ...timetable(), items: [session({ days: [7, -1] })] };
    expect(buildScheduleOccurrences(odd, monday, monday + 7 * DAY)).toEqual([]);
  });

  it("never runs a session past midnight", () => {
    const late = {
      ...timetable(),
      items: [session({ days: [1], startMin: 23 * 60, endMin: 26 * 60 })],
    };
    const [occ] = buildScheduleOccurrences(late, monday, monday + DAY - 1);
    expect(occ.end).toBe(day(1));
  });

  it("sorts a day's sessions by start time", () => {
    const items = [
      session({ id: "late", days: [1], startMin: 14 * 60, endMin: 15 * 60, order: 1 }),
      session({ id: "early", days: [1], startMin: 8 * 60, endMin: 9 * 60, order: 0 }),
    ];
    const out = buildScheduleOccurrences({ ...timetable(), items }, monday, monday + DAY - 1);
    expect(out.map((o) => o.item.title)).toHaveLength(2);
    expect(out[0].start).toBeLessThan(out[1].start);
  });

  it("edits only the session on the exception's day", () => {
    const exceptions: ScheduleException[] = [
      {
        id: "sx:si1:" + monday,
        scheduleId: "s1",
        sessionId: "si1",
        day: monday,
        kind: "edit",
        title: "BIO 201 — Review",
        location: "Lab 4",
        startMin: 10 * 60,
        endMin: 11 * 60 + 30,
        updatedAt: 1,
      },
    ];
    const out = buildScheduleOccurrences(
      timetable({ exceptions }),
      monday,
      monday + 7 * DAY - 1,
    );
    const mondayRow = out.find((row) => row.start >= monday && row.start < monday + DAY)!;
    expect(mondayRow).toMatchObject({ scheduleItemId: "si1", scheduleDay: monday });
    expect(mondayRow.item.title).toBe("BIO 201 — Review");
    expect(mondayRow.item.location).toBe("Lab 4");
    expect(mondayRow.start).toBe(monday + 10 * 60 * 60_000);
    expect(mondayRow.end).toBe(monday + (11 * 60 + 30) * 60_000);

    const wednesday = out.find((row) => row.start >= monday + 2 * DAY)!;
    expect(wednesday.item.title).toBe("BIO 201 — Lecture");
    expect(wednesday.item.location).toBe("Science Hall 2B");
    expect(wednesday.start).toBe(monday + 2 * DAY + 9 * 60 * 60_000);
  });

  it("deletes only the occurrence on the exception's day", () => {
    const exceptions: ScheduleException[] = [
      {
        id: "sx:si1:" + monday,
        scheduleId: "s1",
        sessionId: "si1",
        day: monday,
        kind: "delete",
        updatedAt: 1,
      },
    ];
    const out = buildScheduleOccurrences(
      timetable({ exceptions }),
      monday,
      monday + 7 * DAY - 1,
    );
    expect(out.map((row) => new Date(row.start).getDay())).toEqual([3, 5]);

    const next = buildScheduleOccurrences(
      timetable({ exceptions }),
      monday + 7 * DAY,
      monday + 14 * DAY - 1,
    );
    expect(next.map((row) => new Date(row.start).getDay())).toEqual([1, 3, 5]);
  });
});

describe("onBreak", () => {
  const breaks: ScheduleBreak[] = [
    { id: "b1", scheduleId: "s1", label: "Reading week", from: sod(monday), to: sod(monday + 4 * DAY) },
  ];

  it("includes both endpoints and excludes the day after", () => {
    expect(onBreak(breaks, sod(monday))).toBe(true);
    expect(onBreak(breaks, sod(monday + 4 * DAY))).toBe(true);
    expect(onBreak(breaks, sod(monday + 5 * DAY))).toBe(false);
    expect(onBreak(breaks, sod(monday - DAY))).toBe(false);
  });
});

describe("sessionEnd", () => {
  it("reads a normal slot straight through", () => {
    expect(sessionEnd({ startMin: 540, endMin: 630 })).toBe(630);
  });

  it("gives a slot with no usable end an hour", () => {
    expect(sessionEnd({ startMin: 540, endMin: 540 })).toBe(600);
    expect(sessionEnd({ startMin: 540, endMin: 100 })).toBe(600);
  });

  it("stops at midnight", () => {
    expect(sessionEnd({ startMin: 23 * 60, endMin: 26 * 60 })).toBe(24 * 60);
  });
});

describe("clock helpers", () => {
  it("round-trips a time of day", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(formatClock(570)).toBe("09:30");
    expect(parseClock(formatClock(13 * 60 + 5))).toBe(13 * 60 + 5);
  });

  it("reads rubbish as midnight rather than as NaN", () => {
    expect(parseClock("")).toBe(0);
    expect(parseClock("nonsense")).toBe(0);
    expect(parseClock("09:75")).toBe(9 * 60 + 59);
  });

  it("labels a time the way people say it", () => {
    expect(clockLabel(9 * 60)).toBe("9 AM");
    expect(clockLabel(9 * 60 + 30)).toBe("9:30 AM");
    expect(clockLabel(13 * 60)).toBe("1 PM");
    expect(clockLabel(0)).toBe("12 AM");
  });
});

describe("sessionItem", () => {
  it("leaves out an empty location", () => {
    expect(sessionItem(session({ days: [1], location: "" }), schedule).location).toBeUndefined();
  });
});

describe("orderedWeekdays", () => {
  it("starts the week where the app does", () => {
    expect(orderedWeekdays(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("sessionsOf", () => {
  it("returns one schedule's sessions in editor order", () => {
    const items: ScheduleItem[] = [
      session({ id: "b", days: [1], order: 1 }),
      session({ id: "a", days: [1], order: 0 }),
      session({ id: "c", days: [1], order: 0, scheduleId: "other" }),
    ];
    expect(sessionsOf(items, "s1").map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("term range", () => {
  it("runs only inside its own term, endpoints included", () => {
    expect(runsOn(schedule, sod(monday))).toBe(true);
    expect(runsOn(schedule, day(27))).toBe(true);
    expect(runsOn(schedule, day(-1))).toBe(false);
    expect(runsOn(schedule, day(28))).toBe(false);
  });

  it("keeps sessions before the term starts and after it ends off the calendar", () => {
    const before = buildScheduleOccurrences(timetable(), day(-14), day(-1) + DAY - 1);
    expect(before).toEqual([]);
    const after = buildScheduleOccurrences(timetable(), day(35), day(45) + DAY - 1);
    expect(after).toEqual([]);
  });

  it("drops the last days of a term that stops early", () => {
    // The term ends on the Wednesday of the first week, so Friday is out.
    const term = { ...timetable(), schedules: [{ ...schedule, to: day(2) }] };
    const out = buildScheduleOccurrences(term, monday, day(7) + DAY - 1);
    expect(out.map((o) => new Date(o.start).getDay())).toEqual([1, 3]);
  });

  it("walks calendar days, not 24-hour blocks, across a clock change", () => {
    // Daylight saving ends inside this window; every day must still appear once.
    const out = buildScheduleOccurrences(
      {
        ...timetable(),
        schedules: [{ ...schedule, to: day(35) }],
        items: [session({ days: [0, 1, 2, 3, 4, 5, 6] })],
      },
      day(25),
      day(29) + DAY - 1,
    );
    const starts = out.map((o) => o.start);
    expect(starts).toHaveLength(5);
    expect(new Set(starts).size).toBe(5);
    expect(out.map((o) => new Date(o.start).getDate())).toEqual([30, 31, 1, 2, 3]);
  });
});

describe("break listing", () => {
  const breaks: ScheduleBreak[] = [
    { id: "b2", scheduleId: "s1", label: "Thanksgiving", from: sod(monday + 21 * DAY), to: sod(monday + 22 * DAY) },
    { id: "b1", scheduleId: "s1", label: "Reading week", from: sod(monday + 9 * DAY), to: sod(monday + 13 * DAY) },
    { id: "b3", scheduleId: "other", label: "Elsewhere", from: sod(monday), to: sod(monday) },
  ];

  it("lists a schedule's breaks through the year, earliest first", () => {
    expect(breaksOf(breaks, "s1").map((b) => b.label)).toEqual(["Reading week", "Thanksgiving"]);
  });

  it("counts both endpoints of a break", () => {
    expect(breakDays({ from: sod(monday), to: sod(monday) })).toBe(1);
    expect(breakDays({ from: sod(monday), to: sod(monday + 4 * DAY) })).toBe(5);
  });

  it("reads a break's dates the way a term calendar does", () => {
    expect(breakRangeLabel(breaks[0])).toBe("Oct 26 – Oct 27");
    const single = { id: "x", scheduleId: "s1", label: "Holiday", from: sod(monday), to: sod(monday) };
    expect(breakRangeLabel(single)).toBe("Oct 5");
    expect(breakDaysLabel(single)).toBe("Mon, Oct 5");
  });

  it("summarizes a schedule for its row and editor", () => {
    expect(scheduleSummary(schedule, [session({ days: [1, 3, 5] })], breaks)).toBe(
      "1 session · 2 breaks · Oct 5 – Nov 1",
    );
  });
});

describe("listing a year of breaks", () => {
  const autumn = { id: "s1", scheduleId: "s1", label: "Autumn half term", from: sod(monday + 14 * DAY), to: sod(monday + 18 * DAY) };
  const winter = {
    id: "s2",
    scheduleId: "s1",
    label: "Winter break",
    from: new Date(2026, 11, 21).getTime(),
    to: new Date(2027, 0, 8).getTime(),
  };
  const spring = {
    id: "s3",
    scheduleId: "s1",
    label: "Easter",
    from: new Date(2027, 2, 22).getTime(),
    to: new Date(2027, 3, 2).getTime(),
  };

  it("groups breaks under the month they start in, earliest first", () => {
    const groups = breaksByMonth([spring, winter, autumn]);
    expect(groups.map((g) => g.label)).toEqual(["October 2026", "December 2026", "March 2027"]);
    expect(groups[1].breaks).toEqual([winter]);
  });

  it("names a break by the weekdays it takes out", () => {
    expect(breakDaysLabel(autumn)).toBe("Mon, Oct 19 – Fri, Oct 23");
    const oneDay = { id: "x", scheduleId: "s1", label: "Holiday", from: sod(monday), to: sod(monday) };
    expect(breakDaysLabel(oneDay)).toMatch(/^Mon, Oct 5$/);
  });

  it("counts only the days of a break that fall inside the term", () => {
    const short = { ...schedule, from: sod(monday), to: sod(monday + 15 * DAY) };
    // The break runs five days, but only two of them are still in term.
    expect(breakDays(autumn)).toBe(5);
    expect(breakDaysInTerm(short, autumn)).toBe(2);
    expect(breakDaysInTerm(short, winter)).toBe(0);
  });

  it("totals the days off across a term", () => {
    const short = { ...schedule, from: sod(monday), to: sod(monday + 15 * DAY) };
    expect(daysOffInTerm(short, [autumn, winter])).toBe(2);
    expect(daysOffInTerm(schedule, [])).toBe(0);
  });

  it("places breaks along the term as fractions of its width", () => {
    const spans = termBreakSpans({ from: monday, to: sod(monday + 27 * DAY) }, [autumn]);
    expect(spans).toHaveLength(1);
    expect(spans[0].left).toBeCloseTo(14 / 28, 5);
    expect(spans[0].right).toBeCloseTo(19 / 28, 5);
    expect(spans[0].clipped).toBe(false);
  });

  it("clamps a break that runs past the term and drops the ones outside it", () => {
    const week = { from: monday, to: sod(monday + 4 * DAY) };
    const lastTerm = { id: "last", scheduleId: "s1", label: "Summer", from: sod(monday - 40 * DAY), to: sod(monday - 2 * DAY) };
    const inside = { id: "in", scheduleId: "s1", label: "Taster day", from: sod(monday + 2 * DAY), to: sod(monday + 3 * DAY) };
    expect(termBreakSpans(week, [lastTerm, inside, autumn]).map((s) => s.brk.id)).toEqual(["in"]);
    const overrun = termBreakSpans(week, [
      { ...inside, from: sod(monday + 2 * DAY), to: sod(monday + 30 * DAY) },
    ]);
    expect(overrun[0].clipped).toBe(true);
    expect(overrun[0].right).toBeCloseTo(1, 5);
  });

  it("ticks each month the term touches, starting with its own", () => {
    const months = termMonths({
      from: new Date(2026, 8, 8).getTime(),
      to: new Date(2026, 11, 11).getTime(),
    });
    expect(months.map((m) => m.label)).toEqual(["Sep", "Oct", "Nov", "Dec"]);
    expect(months[0].left).toBe(0);
    expect(months[1].left).toBeGreaterThan(0);
  });

  it("reads a term's length and dates the way a term calendar does", () => {
    expect(termDays(schedule)).toBe(28);
    expect(termRangeLabel(schedule)).toBe("Oct 5 – Nov 1, 2026");
  });
});

describe("nextRunningDay", () => {
  it("finds the next weekday the schedule runs on", () => {
    // Friday 9 October: the next running day for a Mon/Wed/Fri timetable is Monday.
    const friday = sod(monday + 4 * DAY);
    expect(nextRunningDay([session({ days: [1, 3, 5] })], "s1", friday + DAY)).toBe(
      sod(monday + 7 * DAY),
    );
  });

  it("stops at the end of the term", () => {
    const lastWeek = sod(monday + 26 * DAY);
    expect(nextRunningDay([session({ days: [1, 3, 5] })], "s1", lastWeek, schedule)).toBeNull();
  });

  it("has nothing to say about an empty timetable", () => {
    expect(nextRunningDay([], "s1", monday)).toBeNull();
  });
});

describe("hidden schedules", () => {
  const hidden = { ...schedule, id: "s2", name: "Spring 2027", hidden: true };

  it("collects only the schedules marked hidden", () => {
    expect([...hiddenScheduleIds([schedule, hidden])]).toEqual(["s2"]);
    expect(hiddenScheduleIds([schedule]).size).toBe(0);
  });

  it("drops hidden schedules from the list a view draws", () => {
    expect(visibleSchedules([schedule, hidden])).toEqual([schedule]);
  });

  it("returns the same list untouched when nothing is hidden", () => {
    const list = [schedule];
    expect(visibleSchedules(list)).toBe(list);
  });

  it("leaves a hidden timetable with no occurrences once filtered", () => {
    const data = timetable({ schedules: [hidden] });
    const shown = { ...data, schedules: visibleSchedules(data.schedules) };
    expect(buildScheduleOccurrences(shown, monday, monday + 7 * DAY - 1)).toEqual([]);
  });
});
