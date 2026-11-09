import type { Item, Project } from "../types";

/**
 * Hiding a calendar is a view preference, not an edit: its items, goals and
 * timetable stay where they are. These helpers are what the calendar, task and
 * Today views read to leave it out of what they draw.
 */

/** Ids of the calendars the reader has hidden. */
export function hiddenCalendarIds(projects: Project[]): Set<string> {
  const ids = new Set<string>();
  for (const project of projects) {
    if (project.hidden) ids.add(project.id);
  }
  return ids;
}

/**
 * Rows that belong to a visible calendar. Anything without a calendar stays:
 * it was never in a calendar that could be hidden. Works for items and goals
 * alike, so one filter covers every place a calendar's contents are listed.
 */
export function withoutHiddenCalendar<T extends { projectId?: string | null }>(
  rows: T[],
  hidden: Set<string>,
): T[] {
  if (hidden.size === 0) return rows;
  return rows.filter((row) => row.projectId == null || !hidden.has(row.projectId));
}

/** The fields the task-view rules read; items and goals both qualify. */
interface CalendarRow {
  projectId?: string | null;
  dueAt?: number | null;
  status?: string;
  completedAt?: number | null;
}

export interface TaskViewOptions {
  /**
   * Keep past-due tasks on screen even when their calendar is hidden. The
   * setting is for promises already broken: hiding a calendar quiets the plan,
   * not work that is late.
   */
  keepOverdue?: boolean;
  now?: number;
}

/** Still open and past its due time, read structurally so goals can share the filter. */
function isOpenOverdue(row: CalendarRow, now: number): boolean {
  return row.dueAt != null && row.dueAt < now && row.status !== "done" && row.completedAt == null;
}

/**
 * What the task views draw. Hiding a calendar quiets its tasks there too, but
 * filtering to a single calendar is an explicit request: it shows that
 * calendar even when hidden, so a dimmed row in the rail is never a dead end.
 * Used for the goals the task timeline plots as well as for tasks.
 */
export function taskViewRows<T extends CalendarRow>(
  rows: T[],
  hidden: Set<string>,
  filterProjectId: string | null,
  options: TaskViewOptions = {},
): T[] {
  if (filterProjectId) return rows;
  if (!options.keepOverdue) return withoutHiddenCalendar(rows, hidden);
  const now = options.now ?? Date.now();
  return rows.filter(
    (row) => row.projectId == null || !hidden.has(row.projectId) || isOpenOverdue(row, now),
  );
}

export interface HiddenTaskInfo {
  /** Open tasks a hidden calendar is currently keeping out of the views. */
  count: number;
  /** Names of the hidden calendars, so the note can say where they went. */
  calendars: string[];
}

/**
 * The count behind the "N open tasks hidden" note. Done tasks are not counted:
 * quiet history is not something a view needs to account for. With persistent
 * overdue on, late work is not hidden, so it is not counted either.
 */
export function hiddenTaskInfo(
  items: Item[],
  projects: Project[],
  options: TaskViewOptions = {},
): HiddenTaskInfo {
  const hidden = hiddenCalendarIds(projects);
  const calendars = projects.filter((project) => project.hidden).map((project) => project.name);
  if (hidden.size === 0) return { count: 0, calendars };
  const now = options.now ?? Date.now();
  let count = 0;
  for (const item of items) {
    if (item.type !== "task" || item.deletedAt) continue;
    if (item.status === "done" || item.completedAt != null) continue;
    if (!item.projectId || !hidden.has(item.projectId)) continue;
    if (options.keepOverdue && isOpenOverdue(item, now)) continue;
    count++;
  }
  return { count, calendars };
}
