import type { Item } from "../types";
import { eod, sod } from "./date";

/**
 * Move an overdue task to a new day without changing the time of day it was
 * originally due. All-day deadlines stay on the end of their new day.
 */
export function postponedDueAt(task: Pick<Item, "dueAt" | "dueAllDay">, day: number): number | null {
  if (task.dueAt == null) return null;
  const target = sod(day);
  const source = new Date(task.dueAt);
  const dateOnly =
    task.dueAllDay || (source.getHours() === 23 && source.getMinutes() >= 59);
  if (dateOnly) return eod(target);
  const next = new Date(target);
  next.setHours(source.getHours(), source.getMinutes(), 0, 0);
  return next.getTime();
}
