import { describe, expect, it } from "vitest";
import type { Item, WorkProject } from "../types";
import { projectLeaves, projectOverviews, projectSummary, projectTasks } from "./projects";

const project: WorkProject = {
  id: "wp_1",
  name: "Thesis",
  color: "#0d9488",
  start: 1,
  workingDays: [1, 2, 3, 4, 5],
  memberIds: [],
  order: 0,
  createdAt: 1,
  updatedAt: 1,
};

const task = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  type: "task",
  title: id,
  workProjectId: "wp_1",
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const now = Date.now();

describe("projectTasks", () => {
  it("keeps only live tasks in the project", () => {
    const items: Item[] = [
      task("a"),
      task("b", { deletedAt: 5 }),
      task("c", { workProjectId: "wp_2" }),
      { id: "e", type: "event", title: "Event", workProjectId: "wp_1", createdAt: 1, updatedAt: 1 },
    ];
    expect(projectTasks(items, "wp_1").map((i) => i.id)).toEqual(["a"]);
  });

  it("sorts by order", () => {
    const items = [task("b", { order: 2 }), task("a", { order: 1 })];
    expect(projectTasks(items, "wp_1").map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("projectLeaves", () => {
  it("drops summary rows so work is not counted twice", () => {
    const items = [task("parent"), task("child", { parentId: "parent" }), task("solo")];
    expect(projectLeaves(items).map((i) => i.id)).toEqual(["child", "solo"]);
  });
});

describe("projectSummary", () => {
  it("counts completed leaves and finds the earliest open deadline", () => {
    const items = [
      task("parent"),
      task("done", { parentId: "parent", status: "done" }),
      task("late", { parentId: "parent", dueAt: now - 60_000 }),
      task("soon", { dueAt: now + 86_400_000 }),
      task("fresh"),
    ];
    const summary = projectSummary(items, "wp_1");
    expect(summary.tasks).toHaveLength(5);
    expect(summary.leaves).toHaveLength(4);
    expect(summary.done).toBe(1);
    expect(summary.open).toBe(3);
    expect(summary.pct).toBe(25);
    expect(summary.overdue).toBe(1);
    expect(summary.nextDue).toBe(now - 60_000);
  });

  it("uses manual progress for a leaf instead of only counting done", () => {
    const summary = projectSummary(
      [task("a", { progressPct: 40 }), task("b", { progressPct: 80 })],
      "wp_1",
    );
    expect(summary.pct).toBe(60);
    expect(summary.done).toBe(0);
    expect(summary.open).toBe(2);
  });

  it("treats an empty project as zero percent rather than a division error", () => {
    expect(projectSummary([], "wp_1")).toMatchObject({
      done: 0,
      open: 0,
      pct: 0,
      overdue: 0,
      nextDue: null,
    });
  });
});

describe("projectOverviews", () => {
  it("keeps the saved project order", () => {
    const other: WorkProject = { ...project, id: "wp_2", name: "Paper", order: 1 };
    const overviews = projectOverviews([project, other], [task("a"), task("b", { workProjectId: "wp_2" })]);
    expect(overviews.map((o) => o.project.name)).toEqual(["Thesis", "Paper"]);
    expect(overviews.map((o) => o.open)).toEqual([1, 1]);
  });
});
