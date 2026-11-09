import { describe, expect, it } from "vitest";
import type { Item, TaskDependency, WorkProject } from "../types";
import { DAY, eod, sod } from "./date";
import {
  addWorkingDays,
  computeProjectSchedule,
  isWorkingDay,
  moveTaskDates,
  nextWorkingDay,
  resizeTaskDates,
  successorStart,
} from "./projectSchedule";

/** Monday 5 October 2026; the following weekend is 10–11 October. */
const MONDAY = new Date(2026, 9, 5).getTime();
const day = (n: number) => new Date(2026, 9, 5 + n).getTime();

const project = (extra: Partial<WorkProject> = {}): WorkProject => ({
  id: "wp1",
  name: "Launch",
  color: "#4f46e5",
  start: MONDAY,
  workingDays: [1, 2, 3, 4, 5],
  memberIds: [],
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const task = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  type: "task",
  title: id,
  workProjectId: "wp1",
  scheduleMode: "auto",
  durationDays: 1,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const dependency = (
  predecessorId: string,
  successorId: string,
  extra: Partial<TaskDependency> = {},
): TaskDependency => ({
  id: `d_${predecessorId}_${successorId}`,
  workProjectId: "wp1",
  predecessorId,
  successorId,
  type: "FS",
  lagDays: 0,
  createdAt: 0,
  ...extra,
});

const schedule = (tasks: Item[], dependencies: TaskDependency[] = [], extra = {}) =>
  computeProjectSchedule({ project: project(extra), tasks, dependencies });

const startOf = (result: ReturnType<typeof schedule>, id: string) =>
  sod(result.dates.get(id)!.start);
const endOf = (result: ReturnType<typeof schedule>, id: string) =>
  eod(result.dates.get(id)!.end);

describe("working-day arithmetic", () => {
  const weekdays = [1, 2, 3, 4, 5];

  it("knows weekends are not working days", () => {
    expect(isWorkingDay(day(0), weekdays)).toBe(true);
    expect(isWorkingDay(day(5), weekdays)).toBe(false);
    expect(isWorkingDay(day(6), weekdays)).toBe(false);
  });

  it("rolls a weekend onto Monday instead of counting it", () => {
    expect(nextWorkingDay(day(5), weekdays)).toBe(sod(day(7)));
    expect(addWorkingDays(day(4), 1, weekdays)).toBe(sod(day(7)));
  });

  it("counts zero as the starting working day", () => {
    expect(addWorkingDays(day(0), 0, weekdays)).toBe(sod(day(0)));
    expect(addWorkingDays(day(5), 0, weekdays)).toBe(sod(day(7)));
  });

  it("falls back to Monday–Friday when no working days are given", () => {
    expect(isWorkingDay(day(0), [])).toBe(true);
    expect(isWorkingDay(day(5), [])).toBe(false);
  });

  it("puts a finish-to-start successor on the next working day", () => {
    expect(successorStart(eod(day(4)), 0, weekdays)).toBe(sod(day(7)));
    expect(successorStart(eod(day(0)), 2, weekdays)).toBe(sod(day(3)));
  });
});

describe("moveTaskDates", () => {
  it("shifts a task and keeps its working-day duration", () => {
    const moved = moveTaskDates(
      task("a", { durationDays: 3 }),
      { start: day(0), end: eod(day(2)) },
      1,
      [1, 2, 3, 4, 5],
    );
    expect(moved.start).toBe(sod(day(1)));
    expect(moved.end).toBe(eod(day(3)));
  });

  it("lands on the next working day instead of a weekend", () => {
    const moved = moveTaskDates(
      task("a"),
      { start: day(4), end: eod(day(4)) },
      1,
      [1, 2, 3, 4, 5],
    );
    expect(moved.start).toBe(sod(day(7)));
    expect(moved.end).toBe(eod(day(7)));
  });

  it("keeps a milestone on one day", () => {
    const moved = moveTaskDates(
      task("m", { milestone: true, durationDays: 0 }),
      { start: day(0), end: eod(day(0)) },
      2,
      [1, 2, 3, 4, 5],
    );
    expect(moved.start).toBe(sod(day(2)));
    expect(moved.end).toBe(eod(day(2)));
  });

  it("leaves a zero move untouched", () => {
    const current = { start: day(5), end: eod(day(5)) };
    expect(moveTaskDates(task("a"), current, 0, [1, 2, 3, 4, 5])).toEqual(current);
  });
});

describe("resizeTaskDates", () => {
  it("extends the end and reports the new working-day duration", () => {
    const resized = resizeTaskDates(
      task("a", { durationDays: 3 }),
      { start: day(0), end: eod(day(2)) },
      "end",
      2,
      [1, 2, 3, 4, 5],
    );
    expect(resized.start).toBe(sod(day(0)));
    expect(resized.end).toBe(eod(day(4)));
    expect(resized.durationDays).toBe(5);
  });

  it("snaps a weekend end back to the previous working day", () => {
    const resized = resizeTaskDates(
      task("a", { durationDays: 3 }),
      { start: day(0), end: eod(day(2)) },
      "end",
      3,
      [1, 2, 3, 4, 5],
    );
    expect(resized.end).toBe(eod(day(4)));
    expect(resized.durationDays).toBe(5);
  });

  it("moves the start edge without moving the finish", () => {
    const resized = resizeTaskDates(
      task("a", { durationDays: 3 }),
      { start: day(2), end: eod(day(4)) },
      "start",
      -2,
      [1, 2, 3, 4, 5],
    );
    expect(resized.start).toBe(sod(day(0)));
    expect(resized.end).toBe(eod(day(4)));
    expect(resized.durationDays).toBe(5);
  });

  it("never shrinks below one working day", () => {
    const resized = resizeTaskDates(
      task("a", { durationDays: 2 }),
      { start: day(0), end: eod(day(1)) },
      "start",
      9,
      [1, 2, 3, 4, 5],
    );
    expect(resized.start).toBe(sod(day(1)));
    expect(resized.durationDays).toBe(1);
  });

  it("moves a successor when the resized end is persisted", () => {
    const resized = resizeTaskDates(
      task("a", { durationDays: 2 }),
      { start: day(0), end: eod(day(1)) },
      "end",
      2,
      [1, 2, 3, 4, 5],
    );
    const out = schedule(
      [
        task("a", {
          scheduleMode: "manual",
          plannedStart: resized.start,
          plannedEnd: resized.end,
          durationDays: resized.durationDays,
        }),
        task("b"),
      ],
      [dependency("a", "b")],
    );
    expect(startOf(out, "b")).toBe(sod(day(4)));
  });
});

describe("computeProjectSchedule", () => {
  it("places an unlinked auto task at the project start", () => {
    const out = schedule([task("a", { durationDays: 3 })]);
    expect(startOf(out, "a")).toBe(sod(day(0)));
    expect(endOf(out, "a")).toBe(eod(day(2)));
    expect(out.finish).toBe(eod(day(2)));
  });

  it("rolls a weekend project start onto Monday", () => {
    const out = schedule([task("a")], [], { start: day(5) });
    expect(startOf(out, "a")).toBe(sod(day(7)));
  });

  it("defaults a missing duration to one working day", () => {
    const out = schedule([task("a", { durationDays: null })]);
    expect(endOf(out, "a")).toBe(eod(day(0)));
  });

  it("chains tasks and skips the weekend", () => {
    const out = schedule(
      [task("a", { durationDays: 5 }), task("b", { durationDays: 2 })],
      [dependency("a", "b")],
    );
    expect(startOf(out, "a")).toBe(sod(day(0)));
    expect(endOf(out, "a")).toBe(eod(day(4)));
    expect(startOf(out, "b")).toBe(sod(day(7)));
    expect(endOf(out, "b")).toBe(eod(day(8)));
  });

  it("honours lag in working days", () => {
    const out = schedule(
      [task("a"), task("b")],
      [dependency("a", "b", { lagDays: 2 })],
    );
    expect(startOf(out, "b")).toBe(sod(day(3)));
  });

  it("starts after the latest of several predecessors", () => {
    const out = schedule(
      [task("a"), task("b", { durationDays: 3 }), task("c")],
      [dependency("a", "c"), dependency("b", "c")],
    );
    expect(startOf(out, "c")).toBe(sod(day(3)));
  });

  it("keeps a manual task pinned and starts its successor after it", () => {
    const out = schedule(
      [
        task("a"),
        task("b", { scheduleMode: "manual", plannedStart: day(3), plannedEnd: day(3) }),
        task("c"),
      ],
      [dependency("a", "b"), dependency("b", "c")],
    );
    expect(startOf(out, "b")).toBe(sod(day(3)));
    expect(startOf(out, "c")).toBe(sod(day(4)));
    expect(out.conflicts).toEqual([]);
  });

  it("warns when a manual task starts before its predecessor finishes", () => {
    const out = schedule(
      [
        task("a", { durationDays: 3 }),
        task("b", { scheduleMode: "manual", plannedStart: day(1), plannedEnd: day(1) }),
      ],
      [dependency("a", "b")],
    );
    expect(out.conflicts.map((c) => c.kind)).toContain("manual-before-predecessor");
    expect(startOf(out, "b")).toBe(sod(day(1)));
  });

  it("does not move completed work but anchors successors to it", () => {
    const out = schedule(
      [
        task("a", {
          scheduleMode: "auto",
          status: "done",
          completedAt: day(0),
          plannedStart: day(2),
          plannedEnd: day(3),
          durationDays: 2,
        }),
        task("b"),
      ],
      [dependency("a", "b")],
    );
    expect(startOf(out, "a")).toBe(sod(day(2)));
    expect(startOf(out, "b")).toBe(sod(day(4)));
    expect(out.conflicts).toEqual([]);
  });

  it("puts undated completed work on its completion day", () => {
    const out = schedule([
      task("a", { status: "done", completedAt: day(3), plannedStart: null, plannedEnd: null }),
    ]);
    expect(startOf(out, "a")).toBe(sod(day(3)));
    expect(endOf(out, "a")).toBe(eod(day(3)));
  });

  it("treats a manual weekend pin as fixed and moves only its successor", () => {
    const out = schedule(
      [
        task("a", { scheduleMode: "manual", plannedStart: day(5), plannedEnd: day(5) }),
        task("b"),
      ],
      [dependency("a", "b")],
    );
    expect(startOf(out, "a")).toBe(sod(day(5)));
    expect(startOf(out, "b")).toBe(sod(day(7)));
  });

  it("schedules a milestone as one zero-duration day", () => {
    const out = schedule(
      [task("a", { durationDays: 2 }), task("m", { milestone: true, durationDays: 0 }), task("b")],
      [dependency("a", "m"), dependency("m", "b")],
    );
    expect(startOf(out, "m")).toBe(sod(day(2)));
    expect(endOf(out, "m")).toBe(eod(day(2)));
    expect(startOf(out, "b")).toBe(sod(day(3)));
  });

  it("reports tasks and projects that finish after their deadlines", () => {
    const out = schedule([task("a", { durationDays: 3, dueAt: eod(day(1)) })], [], {
      deadline: eod(day(0)),
    });
    expect(out.conflicts.map((c) => c.kind).sort()).toEqual([
      "project-deadline",
      "task-deadline",
    ]);
  });

  it("does not treat a milestone's own date as a missed deadline", () => {
    const out = schedule([
      task("m", { milestone: true, durationDays: 0, dueAt: eod(day(0)) }),
    ]);
    expect(out.conflicts).toEqual([]);
  });

  it("refuses to place tasks when dependencies form a loop", () => {
    const out = schedule(
      [task("a"), task("b")],
      [dependency("a", "b"), dependency("b", "a")],
    );
    expect(out.dates.size).toBe(0);
    expect(out.order).toEqual([]);
    expect(out.conflicts[0].kind).toBe("cycle");
  });

  it("schedules leaves and leaves a summary parent out of the chart", () => {
    const out = schedule([
      task("phase", { durationDays: 10 }),
      task("one", { parentId: "phase" }),
      task("two", { parentId: "phase", durationDays: 2 }),
    ]);
    expect(out.dates.has("phase")).toBe(false);
    expect(startOf(out, "one")).toBe(sod(day(0)));
    expect(endOf(out, "two")).toBe(eod(day(1)));
  });

  it("ignores deleted rows, other projects and non-task items", () => {
    const out = schedule([
      task("a"),
      task("gone", { deletedAt: 1 }),
      task("other", { workProjectId: "wp2" }),
      { ...task("event"), type: "event" },
    ]);
    expect([...out.dates.keys()]).toEqual(["a"]);
  });

  it("ignores dependencies that point outside the project or at itself", () => {
    const out = schedule(
      [task("a"), task("b")],
      [dependency("a", "b"), dependency("a", "b"), dependency("a", "a")],
    );
    expect(startOf(out, "b")).toBe(sod(day(1)));
    expect(out.conflicts).toEqual([]);
  });

  it("does not schedule a successor from a predecessor in a loop", () => {
    const out = schedule(
      [task("a"), task("b"), task("c")],
      [dependency("a", "b"), dependency("b", "a"), dependency("b", "c")],
    );
    expect(out.dates.has("a")).toBe(false);
    expect(out.dates.has("b")).toBe(false);
    expect(out.dates.has("c")).toBe(false);
    expect(out.conflicts[0].kind).toBe("cycle");
  });

  it("keeps a deterministic topological order", () => {
    const out = schedule(
      [task("b"), task("a", { order: 1 }), task("c", { order: 2 })],
      [dependency("a", "c")],
    );
    expect(out.order).toEqual(["b", "a", "c"]);
    expect(out.dates.size).toBe(3);
  });

  it("finishes a chain on the last task's end", () => {
    const out = schedule(
      [task("a"), task("b", { durationDays: 3 })],
      [dependency("a", "b")],
    );
    expect(out.finish).toBe(eod(day(3)));
    expect(out.finish! - out.dates.get("b")!.start).toBe(3 * DAY - 1);
  });
});
