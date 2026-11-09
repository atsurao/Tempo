import { describe, expect, it } from "vitest";
import type { Item, WorkProject } from "../types";
import { eod, sod } from "./date";
import {
  GANTT_SCALE_MAX,
  GANTT_SCALE_MIN,
  buildGanttRows,
  dayWidthForScale,
  ganttRange,
  workingDaysBetween,
} from "./gantt";

const MONDAY = new Date(2026, 9, 5).getTime();
const day = (n: number) => new Date(2026, 9, 5 + n).getTime();
const date = (n: number, span = 0) => ({ start: sod(day(n)), end: eod(day(n + span)) });

const task = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  type: "task",
  title: id,
  workProjectId: "wp1",
  durationDays: 1,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

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

describe("workingDaysBetween", () => {
  it("counts inclusively and skips weekends", () => {
    expect(workingDaysBetween(day(0), day(4), [1, 2, 3, 4, 5])).toBe(5);
    expect(workingDaysBetween(day(5), day(6), [1, 2, 3, 4, 5])).toBe(0);
  });

  it("walks calendar days across a daylight-saving change", () => {
    const start = new Date(2026, 2, 2).getTime();
    const end = new Date(2026, 2, 13).getTime();
    expect(workingDaysBetween(start, end, [1, 2, 3, 4, 5])).toBe(10);
  });
});

describe("buildGanttRows", () => {
  it("keeps outline order and numbers the tree", () => {
    const items = [
      task("b", { order: 2 }),
      task("a", { order: 1 }),
      task("a1", { order: 1, parentId: "a" }),
      task("a2", { order: 2, parentId: "a" }),
    ];
    const rows = buildGanttRows(
      items,
      new Map([
        ["a1", date(0, 1)],
        ["a2", date(3, 1)],
        ["b", date(7)],
      ]),
      [1, 2, 3, 4, 5],
    );
    expect(rows.map((row) => `${row.wbs} ${row.id}`)).toEqual([
      "1 a",
      "1.1 a1",
      "1.2 a2",
      "2 b",
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 0]);
  });

  it("rolls summary dates and duration up from its children", () => {
    const rows = buildGanttRows(
      [task("p"), task("a", { parentId: "p" }), task("b", { parentId: "p" })],
      new Map([
        ["a", date(0, 1)],
        ["b", date(3, 1)],
      ]),
      [1, 2, 3, 4, 5],
    );
    const parent = rows[0];
    expect(parent.summary).toBe(true);
    expect(parent.start).toBe(sod(day(0)));
    expect(parent.end).toBe(eod(day(4)));
    expect(parent.durationDays).toBe(5);
    expect(parent.progress).toBe(0);
  });

  it("computes summary progress from leaves and aggregates warnings", () => {
    const rows = buildGanttRows(
      [task("p"), task("a", { parentId: "p", status: "done" }), task("b", { parentId: "p" })],
      new Map([
        ["a", date(0, 1)],
        ["b", date(1, 1)],
      ]),
      [1, 2, 3, 4, 5],
      new Set(["b"]),
    );
    expect(rows[0].progress).toBe(50);
    expect(rows[0].warnings).toBe(1);
  });

  it("shows a leaf's manual completion and averages it into a summary", () => {
    const rows = buildGanttRows(
      [
        task("p"),
        task("a", { parentId: "p", progressPct: 40 }),
        task("b", { parentId: "p", progressPct: 80 }),
      ],
      new Map([
        ["a", date(0, 1)],
        ["b", date(1, 1)],
      ]),
      [1, 2, 3, 4, 5],
    );
    expect(rows.find((row) => row.id === "a")?.progress).toBe(40);
    expect(rows.find((row) => row.id === "p")?.progress).toBe(60);
  });

  it("marks milestones without making them summaries", () => {
    const rows = buildGanttRows(
      [task("m", { milestone: true, durationDays: 0 })],
      new Map([["m", date(2)]]),
      [1, 2, 3, 4, 5],
    );
    expect(rows[0].milestone).toBe(true);
    expect(rows[0].summary).toBe(false);
    expect(rows[0].durationDays).toBe(0);
  });

  it("surfaces a parent cycle instead of dropping the tasks", () => {
    const rows = buildGanttRows(
      [task("a", { parentId: "b" }), task("b", { parentId: "a" })],
      new Map(),
      [1, 2, 3, 4, 5],
    );
    expect(rows.map((row) => row.id).sort()).toEqual(["a", "b"]);
  });
});

describe("gantt scale", () => {
  it("maps the slider onto a continuous pixels-per-day range", () => {
    expect(dayWidthForScale(0)).toBe(GANTT_SCALE_MIN);
    expect(dayWidthForScale(100)).toBe(GANTT_SCALE_MAX);
    expect(dayWidthForScale(50)).toBeGreaterThan(dayWidthForScale(25));
    expect(dayWidthForScale(75)).toBeGreaterThan(dayWidthForScale(50));
  });

  it("clamps values outside the slider", () => {
    expect(dayWidthForScale(-10)).toBe(GANTT_SCALE_MIN);
    expect(dayWidthForScale(140)).toBe(GANTT_SCALE_MAX);
  });
});

describe("ganttRange", () => {
  it("pads the plan and includes the project deadline", () => {
    const rows = buildGanttRows(
      [task("a")],
      new Map([["a", date(0, 2)]]),
      [1, 2, 3, 4, 5],
    );
    const range = ganttRange(project({ deadline: eod(day(10)) }), rows);
    // The padded start is pulled back to Monday, Sep 28.
    expect(range.from).toBe(sod(day(-7)));
    expect(range.to).toBe(eod(day(13)));
    expect(range.days).toBe(21);
  });

  it("keeps a short project wide enough to read", () => {
    const rows = buildGanttRows([], new Map(), [1, 2, 3, 4, 5]);
    const range = ganttRange(project({ deadline: null }), rows);
    expect(range.days).toBe(14);
  });

  it("always starts on a Monday so week columns line up", () => {
    const wednesday = new Date(2026, 9, 7).getTime();
    const rows = buildGanttRows([], new Map(), [1, 2, 3, 4, 5]);
    const range = ganttRange(project({ start: wednesday, deadline: null }), rows);
    expect(new Date(range.from).getDay()).toBe(1);
  });

  it("counts calendar days across a daylight-saving change", () => {
    const rows = buildGanttRows(
      [task("a")],
      new Map([["a", date(14, 11)]]),
      [1, 2, 3, 4, 5],
    );
    const range = ganttRange(project({ start: day(14), deadline: null }), rows);
    // Oct 12 to Nov 2 inclusive, whatever the local UTC offset does.
    expect(range.days).toBe(22);
    expect(new Date(range.from).getDate()).toBe(12);
  });
});
