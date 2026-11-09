import type { Item, TaskDependency, WorkProject } from "../types";
import { addDays, eod, sod } from "./date";
import { isDone } from "./tasks";

/**
 * The project scheduler is deliberately a pure function: project + tasks +
 * links in, dates and conflicts out. Persisting the result is somebody else's
 * job, which keeps working-day arithmetic and dependency propagation testable
 * without IndexedDB.
 *
 * Dates are day-level. A task's start is the start of its first working day and
 * its end is the end of its last one, so deadline comparisons are inclusive.
 * Milestones are zero-duration: they occupy one day, written as start-of-day to
 * end-of-day so Calendar and Today can read them as a date.
 */

export interface ScheduledDates {
  start: number;
  end: number;
}

export type ScheduleConflictKind =
  | "cycle"
  | "task-deadline"
  | "project-deadline"
  | "manual-before-predecessor";

export interface ScheduleConflict {
  kind: ScheduleConflictKind;
  /** The task the warning is about, when it has one. */
  taskId?: string;
  /** The predecessor responsible for a precedence warning. */
  predecessorId?: string;
  message: string;
}

export interface ProjectSchedule {
  /** Dates for every task that could be placed; cycle members are omitted. */
  dates: Map<string, ScheduledDates>;
  /** Topological order, useful for stable Gantt rows. */
  order: string[];
  conflicts: ScheduleConflict[];
  finish: number | null;
}

export interface ProjectScheduleInput {
  project: WorkProject;
  /** All items; those outside the project are ignored. */
  tasks: Item[];
  dependencies: TaskDependency[];
}

const FALLBACK_WORKING_DAYS = [1, 2, 3, 4, 5];

/** Keep only real weekday numbers; an empty list falls back to Mon–Fri. */
export function normalizeWorkingDays(days: number[]): number[] {
  const valid = [...new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))];
  valid.sort((a, b) => a - b);
  return valid.length > 0 ? valid : [...FALLBACK_WORKING_DAYS];
}

function nextWorkingDayFrom(day: number, workingDays: number[]): number {
  let cursor = sod(day);
  // A guard keeps corrupt working-day data from spinning forever.
  for (let guard = 0; guard < 14; guard++) {
    if (workingDays.includes(new Date(cursor).getDay())) return cursor;
    cursor = addDays(new Date(cursor), 1).getTime();
  }
  return cursor;
}

export function isWorkingDay(ts: number, workingDays: number[]): boolean {
  return normalizeWorkingDays(workingDays).includes(new Date(sod(ts)).getDay());
}

/** The given day, or the next working day if it falls on a weekend. */
export function nextWorkingDay(ts: number, workingDays: number[]): number {
  return nextWorkingDayFrom(ts, normalizeWorkingDays(workingDays));
}

/**
 * Advance by whole working days. Zero returns the starting working day; one
 * moves to the next working day after it.
 */
export function addWorkingDays(ts: number, count: number, workingDays: number[]): number {
  const days = normalizeWorkingDays(workingDays);
  let cursor = nextWorkingDayFrom(ts, days);
  let remaining = Math.max(0, Math.round(count));
  while (remaining > 0) {
    cursor = nextWorkingDayFrom(addDays(new Date(cursor), 1).getTime(), days);
    remaining--;
  }
  return cursor;
}

function dayAfter(ts: number): number {
  return addDays(new Date(sod(ts)), 1).getTime();
}

/**
 * The first working day a finish-to-start successor may begin on. Lag is
 * counted in working days after that day, so lag 0 means "the next working
 * day", and a Friday finish puts the successor on Monday.
 */
export function successorStart(
  predecessorEnd: number,
  lagDays: number,
  workingDays: number[],
): number {
  const days = normalizeWorkingDays(workingDays);
  const next = nextWorkingDayFrom(dayAfter(predecessorEnd), days);
  return addWorkingDays(next, Math.max(0, Math.round(lagDays)), days);
}

/** Working days a task takes; a milestone is zero. Missing duration is one day. */
export function durationOf(task: Item): number {
  if (task.milestone) return 0;
  const raw = task.durationDays ?? 1;
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, Math.round(raw));
}

function previousWorkingDayFrom(ts: number, workingDays: number[]): number {
  let cursor = sod(ts);
  for (let guard = 0; guard < 14; guard++) {
    if (workingDays.includes(new Date(cursor).getDay())) return cursor;
    cursor = addDays(new Date(cursor), -1).getTime();
  }
  return cursor;
}

function workingDaysInRange(start: number, end: number, workingDays: number[]): number {
  let cursor = sod(start);
  const last = sod(end);
  let count = 0;
  for (let guard = 0; cursor <= last && guard < 20_000; guard++) {
    if (workingDays.includes(new Date(cursor).getDay())) count++;
    cursor = sod(addDays(cursor, 1).getTime());
  }
  return count;
}

export type ResizeEdge = "start" | "end";

export interface ResizedTaskDates extends ScheduledDates {
  /** Working days between the new start and end. */
  durationDays: number;
}

/**
 * Resize one edge of a scheduled task to the day under the pointer. The
 * opposite edge stays put, weekends snap inward, and the result never collapses
 * below one working day. Milestones are not resized.
 */
export function resizeTaskDates(
  task: Item,
  current: ScheduledDates,
  edge: ResizeEdge,
  deltaDays: number,
  workingDays: number[],
): ResizedTaskDates {
  const days = normalizeWorkingDays(workingDays);
  if (task.milestone) {
    return { ...current, durationDays: 0 };
  }
  const step = Math.round(deltaDays);
  if (step === 0) {
    return {
      ...current,
      durationDays: Math.max(1, workingDaysInRange(current.start, current.end, days)),
    };
  }

  if (edge === "start") {
    const target = addDays(new Date(sod(current.start)), step).getTime();
    const latestStart = previousWorkingDayFrom(current.end, days);
    const start = Math.min(nextWorkingDayFrom(target, days), latestStart);
    return {
      start,
      end: current.end,
      durationDays: Math.max(1, workingDaysInRange(start, current.end, days)),
    };
  }

  const target = addDays(new Date(current.end), step).getTime();
  const earliestEnd = nextWorkingDayFrom(current.start, days);
  const lastDay = Math.max(previousWorkingDayFrom(target, days), earliestEnd);
  const end = eod(lastDay);
  return {
    start: current.start,
    end,
    durationDays: Math.max(1, workingDaysInRange(current.start, end, days)),
  };
}

/**
 * Move a scheduled task by whole calendar days, then snap it onto a working
 * day. The task keeps its working-day duration, so dragging across a weekend
 * cannot silently shorten or stretch the plan. A zero move returns the input
 * untouched, preserving an existing weekend pin.
 */
export function moveTaskDates(
  task: Item,
  current: ScheduledDates,
  deltaDays: number,
  workingDays: number[],
): ScheduledDates {
  const days = normalizeWorkingDays(workingDays);
  if (deltaDays === 0) return { ...current };
  const target = addDays(new Date(sod(current.start)), Math.round(deltaDays)).getTime();
  const start = nextWorkingDayFrom(target, days);
  const duration = durationOf(task);
  const end =
    duration === 0 ? eod(start) : eod(addWorkingDays(start, duration - 1, days));
  return { start, end };
}

/**
 * Tasks the scheduler places: project leaves. A task with children is a summary
 * row and is rolled up from them instead of being scheduled itself.
 */
export function schedulableTasks(tasks: Item[], workProjectId: string): Item[] {
  const projectTasks = tasks.filter(
    (task) =>
      task.workProjectId === workProjectId && task.type === "task" && !task.deletedAt,
  );
  const parentsWithChildren = new Set<string>();
  for (const task of projectTasks) {
    if (task.parentId) parentsWithChildren.add(task.parentId);
  }
  return projectTasks.filter((task) => !parentsWithChildren.has(task.id));
}

function pinnedDates(task: Item, project: WorkProject, workingDays: number[]): ScheduledDates {
  // A manual task may predate planned dates (an imported task, or one just
  // switched to manual); fall back through the dates the item already has.
  // Completed work without any dates belongs on the day it was finished, not
  // at the start of the project.
  const anchor =
    task.plannedStart ??
    task.start ??
    task.dueAt ??
    (isDone(task) && task.completedAt != null ? task.completedAt : project.start);
  const start = sod(anchor);
  const duration = durationOf(task);
  const durationEnd =
    duration === 0
      ? eod(start)
      : eod(addWorkingDays(start, duration - 1, workingDays));
  const rawEnd = task.plannedEnd ?? task.end;
  const end = rawEnd != null ? eod(rawEnd) : durationEnd;
  return { start, end: Math.max(end, eod(start)) };
}

function rank(task: Item): number {
  return task.order ?? 0;
}

function titleOf(task: Item | undefined): string {
  return task?.title || "Untitled";
}

/**
 * Resolve every leaf the dependency graph can place and report what stands in
 * the way of the rest. Auto tasks move; manual and completed tasks stay put and
 * still constrain what follows them.
 */
export function computeProjectSchedule(input: ProjectScheduleInput): ProjectSchedule {
  const { project } = input;
  const workingDays = normalizeWorkingDays(project.workingDays);
  const projectStart = nextWorkingDayFrom(project.start, workingDays);
  const tasks = schedulableTasks(input.tasks, project.id).sort(
    (a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id),
  );
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const incoming = new Map<string, { predecessorId: string; lagDays: number }[]>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const task of tasks) {
    incoming.set(task.id, []);
    outgoing.set(task.id, []);
    indegree.set(task.id, 0);
  }

  // Dependencies to other projects, missing tasks, summary rows or the task
  // itself cannot be scheduled and are treated as absent.
  const seenPairs = new Set<string>();
  for (const dependency of input.dependencies) {
    if (dependency.workProjectId !== project.id || dependency.type !== "FS") continue;
    const from = dependency.predecessorId;
    const to = dependency.successorId;
    if (from === to || !byId.has(from) || !byId.has(to)) continue;
    const pair = `${from}\u0000${to}`;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);
    incoming.get(to)!.push({
      predecessorId: from,
      lagDays: Math.max(0, Math.round(dependency.lagDays || 0)),
    });
    outgoing.get(from)!.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const byRank = (a: string, b: string) => {
    const left = byId.get(a)!;
    const right = byId.get(b)!;
    return rank(left) - rank(right) || a.localeCompare(b);
  };
  const ready = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(byRank);
    const id = ready.shift()!;
    order.push(id);
    for (const successor of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(successor) ?? 0) - 1;
      indegree.set(successor, remaining);
      if (remaining === 0) ready.push(successor);
    }
  }

  const conflicts: ScheduleConflict[] = [];
  if (order.length < tasks.length) {
    const placed = new Set(order);
    const looped = tasks.filter((task) => !placed.has(task.id));
    conflicts.push({
      kind: "cycle",
      taskId: looped[0]?.id,
      message: `Dependencies could not be resolved because of a loop: ${looped
        .map((task) => `“${titleOf(task)}”`)
        .join(", ")}.`,
    });
  }

  const dates = new Map<string, ScheduledDates>();
  for (const id of order) {
    const task = byId.get(id)!;
    // Completed work is history: it keeps its dates but still anchors what
    // comes after it. Manual tasks are pinned for the same reason, by choice.
    const fixed = task.scheduleMode === "manual" || isDone(task);

    if (fixed) {
      const pinned = pinnedDates(task, project, workingDays);
      dates.set(id, pinned);
      if (!isDone(task)) {
        for (const dependency of incoming.get(id) ?? []) {
          const predecessor = dates.get(dependency.predecessorId);
          if (!predecessor) continue;
          const required = successorStart(
            predecessor.end,
            dependency.lagDays,
            workingDays,
          );
          if (pinned.start < required) {
            conflicts.push({
              kind: "manual-before-predecessor",
              taskId: id,
              predecessorId: dependency.predecessorId,
              message: `“${titleOf(task)}” starts before its predecessor “${titleOf(
                byId.get(dependency.predecessorId),
              )}” finishes.`,
            });
          }
        }
      }
      continue;
    }

    let start = projectStart;
    for (const dependency of incoming.get(id) ?? []) {
      const predecessor = dates.get(dependency.predecessorId);
      if (!predecessor) continue;
      start = Math.max(
        start,
        successorStart(predecessor.end, dependency.lagDays, workingDays),
      );
    }
    start = nextWorkingDayFrom(start, workingDays);
    const duration = durationOf(task);
    const finishDay =
      duration === 0 ? start : addWorkingDays(start, duration - 1, workingDays);
    dates.set(id, { start, end: eod(finishDay) });
  }

  for (const task of tasks) {
    const scheduled = dates.get(task.id);
    if (!scheduled) continue;
    // A milestone's dueAt is its scheduled date, not a deadline to miss.
    if (task.dueAt != null && !task.milestone && scheduled.end > task.dueAt) {
      conflicts.push({
        kind: "task-deadline",
        taskId: task.id,
        message: `“${titleOf(task)}” finishes after its due date.`,
      });
    }
    if (project.deadline != null && scheduled.end > project.deadline) {
      conflicts.push({
        kind: "project-deadline",
        taskId: task.id,
        message: `“${titleOf(task)}” finishes after the project deadline.`,
      });
    }
  }

  let finish: number | null = null;
  for (const scheduled of dates.values()) {
    finish = finish == null ? scheduled.end : Math.max(finish, scheduled.end);
  }

  return { dates, order, conflicts, finish };
}
