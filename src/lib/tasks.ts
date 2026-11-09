import type { Item, Priority } from "../types";

export function liveItems(items: Item[]): Item[] {
  return items.filter((i) => !i.deletedAt);
}

export function childrenOf(items: Item[], id: string): Item[] {
  return items
    .filter((i) => !i.deletedAt && i.parentId === id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Walk recurrenceParentId links up to the series master. */
export function masterOf(item: Item, items: Item[]): Item {
  let current = item;
  let guard = 0;
  while (current.recurrenceParentId && guard++ < 50) {
    const parent = items.find((i) => i.id === current.recurrenceParentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export function descendantIds(items: Item[], id: string): string[] {
  const out: string[] = [];
  const walk = (parentId: string) => {
    for (const child of items) {
      if (child.deletedAt || child.parentId !== parentId) continue;
      out.push(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

export function isDone(item: Item): boolean {
  return item.status === "done" || item.completedAt != null;
}

/**
 * The percentage a task reports. Finished work is always 100, whether it was
 * closed with the checkbox or dragged there with a progress control.
 */
export function completionPct(item: Item): number {
  if (isDone(item)) return 100;
  return Math.max(0, Math.min(100, Math.round(item.progressPct ?? 0)));
}

/** Progress across all descendants; a leaf is its manual percent or 0. */
export function taskProgress(
  items: Item[],
  id: string,
): { done: number; total: number; pct: number } {
  const ids = descendantIds(items, id);
  if (ids.length === 0) {
    const self = items.find((i) => i.id === id);
    const pct = self ? completionPct(self) : 0;
    return { done: self && isDone(self) ? 1 : 0, total: 1, pct };
  }
  let done = 0;
  let sum = 0;
  for (const childId of ids) {
    const child = items.find((i) => i.id === childId);
    if (!child) continue;
    if (isDone(child)) done++;
    sum += completionPct(child);
  }
  return { done, total: ids.length, pct: Math.round(sum / ids.length) };
}

export function rootTasks(items: Item[]): Item[] {
  return items
    .filter((i) => !i.deletedAt && i.type === "task" && !i.parentId)
    .sort((a, b) => {
      const pa = -priorityRank(a.priority);
      const pb = -priorityRank(b.priority);
      if (pa !== pb) return pa - pb;
      const da = a.dueAt ?? Number.MAX_SAFE_INTEGER;
      const db = b.dueAt ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return (a.order ?? 0) - (b.order ?? 0);
    });
}

export function priorityRank(p?: Priority): number {
  return p ?? 0;
}

/** Past its due time and still open — the one definition the views share. */
export function isOverdue(item: Item, now = Date.now()): boolean {
  return item.dueAt != null && item.dueAt < now && !isDone(item);
}

export function dueBucket(
  item: Item,
  now = Date.now(),
): "overdue" | "today" | "soon" | "later" | "none" {
  if (!item.dueAt) return "none";
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (isOverdue(item, now)) return "overdue";
  if (item.dueAt <= endOfToday.getTime()) return "today";
  if (item.dueAt <= now + 7 * 24 * 60 * 60 * 1000) return "soon";
  return "later";
}

/** Subtask completion state for a parent's checkbox. */
export function parentCheckState(
  items: Item[],
  id: string,
): "checked" | "mixed" | "empty" {
  const { done, total } = taskProgress(items, id);
  if (total === 0) return "empty";
  if (done === 0) return "empty";
  if (done === total) return "checked";
  return "mixed";
}
