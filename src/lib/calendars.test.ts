import { describe, expect, it } from "vitest";
import {
  hiddenCalendarIds,
  hiddenTaskInfo,
  taskViewRows,
  withoutHiddenCalendar,
} from "./calendars";
import type { Item, Project } from "../types";

const project = (id: string, hidden?: boolean): Project => ({
  id,
  name: id,
  color: "#000000",
  order: 0,
  hidden,
});

describe("hiddenCalendarIds", () => {
  it("collects only the calendars marked hidden", () => {
    const ids = hiddenCalendarIds([project("a"), project("b", true), project("c", false)]);
    expect([...ids]).toEqual(["b"]);
  });

  it("is empty when nothing is hidden", () => {
    expect(hiddenCalendarIds([project("a"), project("b")]).size).toBe(0);
    expect(hiddenCalendarIds([]).size).toBe(0);
  });
});

describe("withoutHiddenCalendar", () => {
  const hidden = new Set(["school"]);

  it("drops rows from a hidden calendar and keeps the rest", () => {
    const rows = [
      { id: "1", projectId: "school" },
      { id: "2", projectId: "personal" },
      { id: "3", projectId: null },
      { id: "4" },
    ];
    expect(withoutHiddenCalendar(rows, hidden).map((r) => r.id)).toEqual(["2", "3", "4"]);
  });

  it("returns every row untouched when no calendar is hidden", () => {
    const rows = [{ id: "1", projectId: "school" }];
    expect(withoutHiddenCalendar(rows, new Set())).toBe(rows);
  });

  it("works for goals as well as items", () => {
    const goals = [
      { id: "g1", projectId: "school" },
      { id: "g2", projectId: undefined },
    ];
    expect(withoutHiddenCalendar(goals, hidden).map((g) => g.id)).toEqual(["g2"]);
  });
});

describe("taskViewRows", () => {
  const rows = [
    { id: "1", projectId: "school" },
    { id: "2", projectId: "personal" },
    { id: "3", projectId: null },
  ];
  const hidden = new Set(["school"]);

  it("drops a hidden calendar's rows when no calendar is filtered to", () => {
    expect(taskViewRows(rows, hidden, null).map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("shows a hidden calendar's rows when it is the explicit filter", () => {
    expect(taskViewRows(rows, hidden, "school")).toBe(rows);
  });

  it("changes nothing when no calendar is hidden", () => {
    expect(taskViewRows(rows, new Set(), null)).toBe(rows);
  });
});

const NOW = 1_800_000_000_000;

const task = (
  id: string,
  projectId: string | null,
  dueAt: number | null = null,
  done = false,
): Item => ({
  id,
  type: "task",
  title: id,
  projectId,
  dueAt,
  status: done ? "done" : "todo",
  completedAt: done ? NOW : null,
  createdAt: 0,
  updatedAt: 0,
});

describe("taskViewRows with persistent overdue", () => {
  const hidden = new Set(["school"]);
  const rows = [
    task("late", "school", NOW - 60_000),
    task("later", "school", NOW + 60_000),
    task("finished", "school", NOW - 60_000, true),
    task("personal", "personal"),
  ];

  it("keeps a hidden calendar's overdue open tasks and drops the rest", () => {
    const kept = taskViewRows(rows, hidden, null, { keepOverdue: true, now: NOW });
    expect(kept.map((r) => r.id)).toEqual(["late", "personal"]);
  });

  it("still drops completed tasks, even past due", () => {
    const kept = taskViewRows(rows, hidden, null, { keepOverdue: true, now: NOW });
    expect(kept.some((r) => r.id === "finished")).toBe(false);
  });

  it("hides overdue work as usual when the setting is off", () => {
    expect(taskViewRows(rows, hidden, null, { now: NOW }).map((r) => r.id)).toEqual(["personal"]);
  });

  it("lets an explicit calendar filter beat both rules", () => {
    expect(taskViewRows(rows, hidden, "school", { keepOverdue: false, now: NOW })).toBe(rows);
  });
});

describe("hiddenTaskInfo", () => {
  const projects = [project("School", true), project("Personal")];
  const items = [
    task("open", "School"),
    task("late", "School", NOW - 60_000),
    task("finished", "School", null, true),
    task("personal", "Personal"),
    { ...task("event", "School"), type: "event" as const },
    { ...task("deleted", "School"), deletedAt: NOW },
  ];

  it("counts open tasks hidden with their calendars", () => {
    expect(hiddenTaskInfo(items, projects, { now: NOW })).toEqual({
      count: 2,
      calendars: ["School"],
    });
  });

  it("does not count overdue work that stays visible", () => {
    expect(hiddenTaskInfo(items, projects, { keepOverdue: true, now: NOW }).count).toBe(1);
  });

  it("reports nothing when no calendar is hidden", () => {
    expect(hiddenTaskInfo(items, [project("School"), project("Personal")], { now: NOW })).toEqual({
      count: 0,
      calendars: [],
    });
  });
});
