import { describe, expect, it } from "vitest";
import type { Item } from "../types";
import {
  childrenOf,
  completionPct,
  descendantIds,
  dueBucket,
  isDone,
  isOverdue,
  masterOf,
  parentCheckState,
  rootTasks,
  taskProgress,
} from "./tasks";

const task = (id: string, patch: Partial<Item> = {}): Item => ({
  id,
  type: "task",
  title: id,
  createdAt: 0,
  updatedAt: 0,
  status: "todo",
  ...patch,
});

describe("task tree", () => {
  const items: Item[] = [
    task("root"),
    task("a", { parentId: "root" }),
    task("b", { parentId: "root", status: "done", completedAt: 1 }),
    task("a1", { parentId: "a" }),
    task("other"),
  ];

  it("finds direct children in order", () => {
    expect(childrenOf(items, "root").map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("lists all descendants", () => {
    expect(descendantIds(items, "root").sort()).toEqual(["a", "a1", "b"]);
  });

  it("rolls progress up from leaves", () => {
    expect(taskProgress(items, "root")).toEqual({ done: 1, total: 3, pct: 33 });
    expect(parentCheckState(items, "root")).toBe("mixed");
  });

  it("only returns top-level tasks", () => {
    const roots = rootTasks(items).map((i) => i.id);
    expect(roots).toContain("root");
    expect(roots).toContain("other");
    expect(roots).not.toContain("a1");
  });

  it("treats completedAt as done even without status", () => {
    expect(isDone(task("x", { completedAt: 5, status: "todo" }))).toBe(true);
  });

  it("reports manual progress and makes done always 100", () => {
    expect(completionPct(task("a", { progressPct: 40 }))).toBe(40);
    expect(completionPct(task("b", { progressPct: 40, status: "done" }))).toBe(100);
    expect(completionPct(task("c", { progressPct: 140 }))).toBe(100);
  });

  it("rolls manual percentages up through a parent", () => {
    const progressItems = [
      task("root"),
      task("a", { parentId: "root", progressPct: 40 }),
      task("b", { parentId: "root", progressPct: 80 }),
    ];
    expect(taskProgress(progressItems, "root")).toEqual({ done: 0, total: 2, pct: 60 });
  });

  it("walks up to the series master", () => {
    const master = task("m", { recurrence: { rrule: "FREQ=DAILY" } });
    const child = task("c", { recurrenceParentId: "m" });
    const grandchild = task("g", { recurrenceParentId: "c" });
    expect(masterOf(grandchild, [master, child, grandchild]).id).toBe("m");
  });
});

describe("dueBucket", () => {
  const now = new Date(2026, 9, 17, 10, 0).getTime();
  it("classifies overdue, today, soon and later", () => {
    expect(dueBucket(task("a", { dueAt: now - 1000 }), now)).toBe("overdue");
    expect(dueBucket(task("b", { dueAt: now + 3_600_000 }), now)).toBe("today");
    expect(dueBucket(task("c", { dueAt: now + 2 * 86_400_000 }), now)).toBe("soon");
    expect(dueBucket(task("d", { dueAt: now + 20 * 86_400_000 }), now)).toBe("later");
    expect(dueBucket(task("e"), now)).toBe("none");
  });

  it("does not call a completed task overdue", () => {
    expect(dueBucket(task("a", { dueAt: now - 1000, status: "done" }), now)).toBe("today");
  });
});

describe("isOverdue", () => {
  const now = new Date(2026, 9, 17, 10, 0).getTime();
  it("is true only for past due dates on open work", () => {
    expect(isOverdue(task("a", { dueAt: now - 1 }), now)).toBe(true);
    expect(isOverdue(task("b", { dueAt: now + 1 }), now)).toBe(false);
    expect(isOverdue(task("c"), now)).toBe(false);
  });

  it("goes quiet once the task is done", () => {
    expect(isOverdue(task("a", { dueAt: now - 1000, status: "done" }), now)).toBe(false);
    expect(isOverdue(task("b", { dueAt: now - 1000, completedAt: 5 }), now)).toBe(false);
  });
});
