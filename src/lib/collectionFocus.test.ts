import { describe, expect, it } from "vitest";
import type {
  Item,
  Occurrence,
  Schedule,
  ScheduleException,
  ScheduleItem,
} from "../types";
import { sod } from "./date";
import {
  isHighlightedOccurrence,
  nextCalendarDate,
  nextScheduleDate,
} from "./collectionFocus";

const item = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  type: "event",
  title: id,
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

const occurrence = (
  id: string,
  patch: Partial<Occurrence> & { item?: Item } = {},
): Occurrence => {
  const own = patch.item ?? item(id);
  return {
    key: id,
    item: own,
    start: sod(new Date(2026, 9, 19).getTime()),
    end: sod(new Date(2026, 9, 19).getTime()) + 3_600_000,
    isRecurring: false,
    ...patch,
  };
};

describe("nextCalendarDate", () => {
  const now = new Date(2026, 9, 19, 10).getTime();

  it("picks the next dated item and ignores other calendars", () => {
    const items = [
      item("past", { projectId: "cal_1", dueAt: now - 86_400_000 }),
      item("next", { projectId: "cal_1", start: now + 86_400_000 }),
      item("other", { projectId: "cal_2", start: now + 3_600_000 }),
    ];
    expect(nextCalendarDate(items, "cal_1", now)).toBe(now + 86_400_000);
  });

  it("falls back to the most recent item when all are in the past", () => {
    const older = now - 5 * 86_400_000;
    const newer = now - 2 * 86_400_000;
    const items = [
      item("older", { projectId: "cal_1", start: older }),
      item("newer", { projectId: "cal_1", start: newer }),
    ];
    expect(nextCalendarDate(items, "cal_1", now)).toBe(newer);
  });

  it("returns null for an empty calendar", () => {
    expect(nextCalendarDate([], "cal_1", now)).toBeNull();
  });
});

describe("nextScheduleDate", () => {
  const now = new Date(2026, 9, 19, 10).getTime();
  const schedule: Schedule = {
    id: "s_1",
    name: "Term",
    color: "#4f46e5",
    order: 0,
    from: sod(now),
    to: sod(now) + 30 * 86_400_000,
    createdAt: 0,
    updatedAt: 0,
  };
  const session: ScheduleItem = {
    id: "si_1",
    scheduleId: "s_1",
    name: "Lecture",
    days: [1],
    startMin: 9 * 60,
    endMin: 10 * 60,
    order: 0,
  };

  it("finds the next weekly session", () => {
    const next = nextScheduleDate(schedule, [session], [], now);
    expect(next).toBe(sod(now) + 9 * 3_600_000);
  });

  it("honors a one-off deletion of the next session", () => {
    const deleted: ScheduleException = {
      id: "sx_1",
      scheduleId: "s_1",
      sessionId: "si_1",
      day: sod(now),
      kind: "delete",
      updatedAt: 1,
    };
    const next = nextScheduleDate(schedule, [session], [], now, [deleted]);
    expect(next).toBe(sod(now) + 7 * 86_400_000 + 9 * 3_600_000);
  });

  it("returns null when the term has no future sessions", () => {
    const past: Schedule = { ...schedule, from: sod(now) - 60 * 86_400_000, to: sod(now) - 30 * 86_400_000 };
    expect(nextScheduleDate(past, [session], [], now)).toBe(sod(past.from));
  });
});

describe("isHighlightedOccurrence", () => {
  it("matches a calendar item or a schedule session", () => {
    const event = item("e", { projectId: "cal_1" });
    const highlight = {
      kind: "calendar" as const,
      id: "cal_1",
      nonce: 1,
      expiresAt: 2,
    };
    expect(isHighlightedOccurrence(occurrence("e", { item: event }), highlight)).toBe(true);
    expect(
      isHighlightedOccurrence(
        occurrence("s", { item: event, scheduleId: "s_1" }),
        highlight,
      ),
    ).toBe(false);
    expect(
      isHighlightedOccurrence(occurrence("s", { item: event, scheduleId: "s_1" }), {
        kind: "schedule",
        id: "s_1",
        nonce: 1,
        expiresAt: 2,
      }),
    ).toBe(true);
  });
});
