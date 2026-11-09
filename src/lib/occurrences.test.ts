import { describe, expect, it } from "vitest";
import type { Item } from "../types";
import { sod } from "./date";
import { buildOccurrences } from "./occurrences";

const task = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  type: "task",
  title: id,
  createdAt: 0,
  updatedAt: 0,
  status: "todo",
  ...patch,
});

const day = (d: number, h = 0, m = 0): number =>
  sod(new Date(2026, 9, d).getTime()) + h * 3_600_000 + m * 60_000;

const window = { from: day(19), to: day(25, 23, 59) };

describe("task time blocks", () => {
  it("draws every block a task has, each with its own id", () => {
    const item = task("t", {
      timeblocks: [
        { id: "a", start: day(19, 9), end: day(19, 10) },
        { id: "b", start: day(21, 14), end: day(21, 16) },
      ],
    });
    const occs = buildOccurrences([item], window.from, window.to);
    expect(occs.map((o) => o.blockId).sort()).toEqual(["a", "b"]);
    expect(occs.every((o) => !o.isDue)).toBe(true);
  });

  it("still shows the placement of a task saved before blocks", () => {
    const occs = buildOccurrences(
      [task("t", { start: day(20, 9), end: day(20, 10) })],
      window.from,
      window.to,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0].blockId).toBe("legacy");
  });

  it("gives a task with no blocks and no due date nothing to draw", () => {
    expect(buildOccurrences([task("t")], window.from, window.to)).toHaveLength(0);
  });
});

describe("due markers", () => {
  it("marks the due day even when the work is blocked out earlier", () => {
    const item = task("t", {
      dueAt: day(23, 23, 59),
      timeblocks: [{ id: "a", start: day(19, 9), end: day(19, 10) }],
    });
    const occs = buildOccurrences([item], window.from, window.to);
    const due = occs.filter((o) => o.isDue);
    expect(due).toHaveLength(1);
    expect(due[0].start).toBe(day(23, 23, 59));
    expect(occs.filter((o) => o.blockId === "a")).toHaveLength(1);
  });

  it("keeps the plain due marker key for a task without blocks", () => {
    const occs = buildOccurrences([task("t", { dueAt: day(21) })], window.from, window.to);
    expect(occs.map((o) => o.key)).toEqual(["t"]);
    expect(occs[0].isDue).toBe(true);
  });

  it("leaves a completed task's due marker in place, styled as done elsewhere", () => {
    const occs = buildOccurrences(
      [task("t", { dueAt: day(21), status: "done", completedAt: 1 })],
      window.from,
      window.to,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0].isDue).toBe(true);
  });
});

describe("repeating blocks", () => {
  const item = task("t", {
    timeblocks: [
      {
        id: "weekly",
        start: day(19, 9),
        end: day(19, 10),
        recurrence: { rrule: "FREQ=WEEKLY;BYDAY=MO" },
      },
    ],
  });

  it("expands a block on its own rule", () => {
    const occs = buildOccurrences([item], window.from, day(31, 23, 59));
    expect(occs.map((o) => o.start)).toEqual([day(19, 9), day(26, 9)]);
    expect(occs.every((o) => o.blockId === "weekly" && o.isRecurring)).toBe(true);
  });

  it("does not repeat the task's due date with the block", () => {
    const withDue = { ...item, dueAt: day(20, 17) };
    const occs = buildOccurrences([withDue], window.from, day(31, 23, 59));
    expect(occs.filter((o) => o.isDue)).toHaveLength(1);
    expect(occs.filter((o) => o.blockId === "weekly")).toHaveLength(2);
  });

  it("puts a moved occurrence in its new slot instead of the old one", () => {
    const moved: Item = {
      ...item,
      id: "t@moved",
      recurrenceParentId: "t",
      originalStart: day(19, 9),
      recurrenceBlockId: "weekly",
      timeblocks: [],
      start: day(20, 15),
      end: day(20, 16),
      recurrence: null,
    };
    const occs = buildOccurrences([item, moved], window.from, day(31, 23, 59));
    const starts = occs.map((o) => o.start);
    expect(starts).toContain(day(20, 15));
    expect(starts).not.toContain(day(19, 9));
    expect(starts).toContain(day(26, 9));
    expect(occs.find((o) => o.start === day(20, 15))?.blockId).toBe("weekly");
  });

  it("keeps a cancelled occurrence's slot empty", () => {
    const cancelled: Item = {
      ...item,
      id: "t:cancelled",
      recurrenceParentId: "t",
      originalStart: day(19, 9),
      recurrenceBlockId: "weekly",
      cancelled: true,
    };
    const occs = buildOccurrences([item, cancelled], window.from, day(31, 23, 59));
    expect(occs.map((o) => o.start)).toEqual([day(26, 9)]);
  });

  it("leaves a block's own window alone when another block is outside it", () => {
    const twoBlocks = task("t2", {
      timeblocks: [
        { id: "a", start: day(19, 9), end: day(19, 10), recurrence: { rrule: "FREQ=DAILY" } },
        { id: "b", start: day(30, 9), end: day(30, 10) },
      ],
    });
    const occs = buildOccurrences([twoBlocks], window.from, window.to);
    expect(occs.every((o) => o.blockId === "a")).toBe(true);
    expect(occs).toHaveLength(7);
  });
});

describe("events keep their old shape", () => {
  it("expands a repeating event", () => {
    const event: Item = {
      id: "e",
      type: "event",
      title: "Lecture",
      createdAt: 0,
      updatedAt: 0,
      start: day(19, 9),
      end: day(19, 10),
      recurrence: { rrule: "FREQ=DAILY;COUNT=3" },
    };
    const occs = buildOccurrences([event], window.from, window.to);
    expect(occs).toHaveLength(3);
    expect(occs.every((o) => !o.isDue)).toBe(true);
  });

  it("ignores a deleted task", () => {
    const deleted = task("t", { dueAt: day(21), deletedAt: 5 });
    expect(buildOccurrences([deleted], window.from, window.to)).toHaveLength(0);
  });

  it("keeps a block that starts before the window and runs into it", () => {
    const item = task("t", {
      timeblocks: [{ id: "long", start: day(18, 22), end: day(19, 2) }],
    });
    const occs = buildOccurrences([item], window.from, window.to);
    expect(occs).toHaveLength(1);
    expect(occs[0].end - occs[0].start).toBe(4 * 3_600_000);
  });

  it("gives the due marker and the day's block separate keys", () => {
    const item = task("t", {
      dueAt: day(20, 23, 59),
      timeblocks: [{ id: "a", start: day(20, 9), end: day(20, 10) }],
    });
    const occs = buildOccurrences([item], window.from, window.to);
    expect(occs).toHaveLength(2);
    expect(new Set(occs.map((o) => o.key)).size).toBe(2);
    expect(occs.filter((o) => o.isDue)[0].start).toBe(day(20, 23, 59));
    expect(occs.filter((o) => o.blockId === "a")[0].start).toBe(day(20, 9));
  });
});
