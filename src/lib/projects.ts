import type { Item, WorkProject } from "../types";
import { completionPct, isDone, isOverdue } from "./tasks";

/** Live tasks that belong to a work project, in outline order. */
export function projectTasks(items: Item[], workProjectId: string): Item[] {
  return items
    .filter(
      (item) =>
        item.type === "task" &&
        item.workProjectId === workProjectId &&
        !item.deletedAt,
    )
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Leaves are the work the project actually measures: a parent with children is
 * a summary, so counting it too would count the same work twice.
 */
export function projectLeaves(tasks: Item[]): Item[] {
  const parents = new Set<string>();
  for (const task of tasks) {
    if (task.parentId) parents.add(task.parentId);
  }
  return tasks.filter((task) => !parents.has(task.id));
}

export interface ProjectSummary {
  tasks: Item[];
  leaves: Item[];
  done: number;
  open: number;
  overdue: number;
  pct: number;
  /** Earliest open deadline, or null when nothing is dated. */
  nextDue: number | null;
}

export function projectSummary(items: Item[], workProjectId: string): ProjectSummary {
  const tasks = projectTasks(items, workProjectId);
  const leaves = projectLeaves(tasks);
  const done = leaves.filter(isDone).length;
  const open = leaves.length - done;
  const progress = leaves.reduce((sum, task) => sum + completionPct(task), 0);
  const overdue = leaves.filter((task) => isOverdue(task)).length;
  let nextDue: number | null = null;
  for (const task of leaves) {
    if (isDone(task) || task.dueAt == null) continue;
    nextDue = nextDue == null ? task.dueAt : Math.min(nextDue, task.dueAt);
  }
  return {
    tasks,
    leaves,
    done,
    open,
    overdue,
    pct: leaves.length === 0 ? 0 : Math.round(progress / leaves.length),
    nextDue,
  };
}

export interface ProjectOverview extends ProjectSummary {
  project: WorkProject;
}

/** Index cards read these; the order is the user's saved project order. */
export function projectOverviews(
  projects: WorkProject[],
  items: Item[],
): ProjectOverview[] {
  return projects.map((project) => ({
    project,
    ...projectSummary(items, project.id),
  }));
}
