import { addDays, differenceInCalendarDays } from "date-fns";
import type { Item, WorkProject } from "../types";
import type { ScheduledDates } from "./projectSchedule";
import { durationOf, normalizeWorkingDays } from "./projectSchedule";
import { eod, sod } from "./date";
import { completionPct } from "./tasks";

/**
 * The Gantt outline is a read model: it keeps the task tree, rolls summary
 * dates up from the scheduled leaves, and adds the columns a planner expects.
 * Nothing here writes to the database.
 */
export interface GanttRow {
  id: string;
  task: Item;
  depth: number;
  /** Outline number such as 1 or 1.2. */
  wbs: string;
  start: number | null;
  end: number | null;
  /** Working days for a leaf; the span of its rolled-up children for a summary. */
  durationDays: number | null;
  progress: number;
  milestone: boolean;
  summary: boolean;
  warnings: number;
}

interface BuiltRow {
  row: GanttRow;
  leaves: number;
  progressSum: number;
  warnings: number;
}

function sortTasks(a: Item, b: Item): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Working days from `start` to `end`, inclusive, clipped to a sane span. */
export function workingDaysBetween(
  start: number,
  end: number,
  workingDays: number[],
): number {
  const days = normalizeWorkingDays(workingDays);
  let cursor = sod(start);
  const last = sod(end);
  let count = 0;
  // Corrupt dates should not make the outline loop forever.
  for (let guard = 0; cursor <= last && guard < 20_000; guard++) {
    if (days.includes(new Date(cursor).getDay())) count++;
    cursor = sod(addDays(cursor, 1).getTime());
  }
  return count;
}

/**
 * Walk the task tree in outline order. A parent whose children were deleted or
 * belong elsewhere simply behaves as a leaf, and a malformed parent cycle is
 * broken by treating the remaining task as a root.
 */
export function buildGanttRows(
  tasks: Item[],
  dates: Map<string, ScheduledDates>,
  workingDays: number[],
  conflicted: Set<string> = new Set(),
): GanttRow[] {
  const sorted = [...tasks].sort(sortTasks);
  const byId = new Map(sorted.map((task) => [task.id, task]));
  const children = new Map<string, Item[]>();
  const roots: Item[] = [];

  for (const task of sorted) {
    if (task.parentId && byId.has(task.parentId) && task.parentId !== task.id) {
      const list = children.get(task.parentId) ?? [];
      list.push(task);
      children.set(task.parentId, list);
    } else {
      roots.push(task);
    }
  }

  const visited = new Set<string>();
  const rows: GanttRow[] = [];

  const walk = (task: Item, depth: number, wbs: string, ancestors: Set<string>): BuiltRow => {
    visited.add(task.id);
    const nextAncestors = new Set(ancestors).add(task.id);
    const kids = (children.get(task.id) ?? []).filter(
      (child) => !visited.has(child.id) && !nextAncestors.has(child.id),
    );
    const builtKids = kids.map((child, index) =>
      walk(child, depth + 1, `${wbs}.${index + 1}`, nextAncestors),
    );

    const scheduled = dates.get(task.id);
    let start = scheduled?.start ?? null;
    let end = scheduled?.end ?? null;
    let leaves = 1;
    let progressSum = completionPct(task);
    let warnings = conflicted.has(task.id) ? 1 : 0;

    if (builtKids.length > 0) {
      start = null;
      end = null;
      leaves = 0;
      progressSum = 0;
      warnings = 0;
      for (const child of builtKids) {
        if (child.row.start != null) {
          start = start == null ? child.row.start : Math.min(start, child.row.start);
        }
        if (child.row.end != null) {
          end = end == null ? child.row.end : Math.max(end, child.row.end);
        }
        leaves += child.leaves;
        progressSum += child.progressSum;
        warnings += child.warnings;
      }
    }

    const summary = builtKids.length > 0;
    const row: GanttRow = {
      id: task.id,
      task,
      depth,
      wbs,
      start,
      end,
      durationDays:
        start != null && end != null
          ? summary
            ? workingDaysBetween(start, end, workingDays)
            : durationOf(task)
          : null,
      progress: leaves === 0 ? 0 : Math.round(progressSum / leaves),
      milestone: Boolean(task.milestone) && !summary,
      summary,
      warnings,
    };
    rows.push(row);
    return { row, leaves, progressSum, warnings };
  };

  roots.forEach((task, index) => walk(task, 0, String(index + 1), new Set()));
  // A cycle of parent pointers leaves no root behind; surface those tasks
  // rather than silently dropping them from the outline.
  for (const task of sorted) {
    if (!visited.has(task.id)) walk(task, 0, String(rows.length + 1), new Set());
  }

  // Rows are built bottom-up so summaries can roll up their children, then
  // put back into outline order.
  const path = (wbs: string) => wbs.split(".").map(Number);
  rows.sort((a, b) => {
    const left = path(a.wbs);
    const right = path(b.wbs);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return left.length - right.length;
  });
  return rows;
}

export interface GanttRange {
  from: number;
  to: number;
  days: number;
}

const PAD_DAYS = 3;
const MIN_DAYS = 14;

/** The full plan, padded so bars and labels never touch the edges. */
export function ganttRange(project: WorkProject, rows: GanttRow[]): GanttRange {
  let first = project.start;
  let last = project.deadline ?? project.start;
  for (const row of rows) {
    if (row.start != null) first = Math.min(first, row.start);
    if (row.end != null) last = Math.max(last, row.end);
  }
  // Calendar-day arithmetic (not 24-hour blocks) keeps week columns lined up
  // and day counts exact across daylight-saving changes.
  const padded = sod(addDays(first, -PAD_DAYS).getTime());
  // Week columns read best when the chart opens on a Monday, so pull the
  // padded start back to the start of its week.
  const from = sod(addDays(padded, -((new Date(padded).getDay() + 6) % 7)).getTime());
  let to = eod(addDays(last, PAD_DAYS).getTime());
  let days = differenceInCalendarDays(to, from) + 1;
  if (days < MIN_DAYS) {
    to = eod(addDays(from, MIN_DAYS - 1).getTime());
    days = MIN_DAYS;
  }
  return { from, to, days };
}

/**
 * The timeline scale is continuous: the toolbar slider maps 0–100 onto a
 * logarithmic pixels-per-day range, so weeks and months stay reachable
 * without stopping at three fixed zoom levels.
 */
export const GANTT_SCALE_MIN = 2.5;
export const GANTT_SCALE_MAX = 64;
export const GANTT_SCALE_DEFAULT = 78;

export function dayWidthForScale(value: number): number {
  const position = Math.min(100, Math.max(0, value)) / 100;
  return GANTT_SCALE_MIN * Math.pow(GANTT_SCALE_MAX / GANTT_SCALE_MIN, position);
}

export const GANTT_ROW_HEIGHT = 30;
