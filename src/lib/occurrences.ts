import type { Item, Occurrence } from "../types";
import { expandRecurrence } from "./recurrence";
import { blocksOf } from "./timeblocks";

function overlaps(start: number, end: number, from: number, to: number): boolean {
  return start < to && Math.max(end, start + 1) > from;
}

/**
 * Everything the calendar should draw in [from, to].
 *
 * Recurring masters are expanded lazily. Exception instances (a single
 * occurrence that was moved, edited, or deleted) replace their slot in the
 * series, and moved exceptions are drawn wherever they were moved to.
 *
 * Tasks draw two things: every time block booked for them — each block
 * repeating on its own rule — and a marker on the day they are due, even when
 * the work itself is blocked out on another day.
 */
export function buildOccurrences(items: Item[], from: number, to: number): Occurrence[] {
  const alive = items.filter((i) => !i.deletedAt);
  const live = alive.filter((i) => !i.cancelled);
  const exceptions = new Map<string, Map<number, Item>>();

  // Cancelled exceptions must still claim their slot, so build the map from
  // every live item and skip cancelled ones when emitting.
  for (const item of alive) {
    if (!item.recurrenceParentId || item.originalStart == null) continue;
    let map = exceptions.get(item.recurrenceParentId);
    if (!map) {
      map = new Map();
      exceptions.set(item.recurrenceParentId, map);
    }
    map.set(item.originalStart, item);
  }

  const out: Occurrence[] = [];
  const emitted = new Set<string>();

  const push = (occ: Occurrence) => {
    if (emitted.has(occ.key)) return;
    emitted.add(occ.key);
    out.push(occ);
  };

  const pushDue = (item: Item, at: number, key: string, recurring = false, originalStart?: number) => {
    push({
      key,
      item,
      start: at,
      end: at,
      isRecurring: recurring,
      isDue: true,
      ...(originalStart != null ? { originalStart } : {}),
    });
  };

  for (const item of live) {
    if (item.recurrenceParentId) continue;

    if (item.type === "task") {
      const blocks = blocksOf(item);

      // A task repeating on its due date is the old shape; keep it readable.
      if (item.recurrence && blocks.length === 0 && item.dueAt != null) {
        const seriesExceptions = exceptions.get(item.id) ?? new Map<number, Item>();
        for (const inst of expandRecurrence(item, from, to)) {
          if (seriesExceptions.has(inst.originalStart)) continue;
          if (inst.start < from || inst.start > to) continue;
          pushDue(item, inst.start, `${item.id}@${inst.originalStart}`, true, inst.originalStart);
        }
        continue;
      }

      // The due date is its own marker, whether or not time is blocked out.
      if (item.dueAt != null && item.dueAt >= from && item.dueAt <= to) {
        pushDue(item, item.dueAt, blocks.length > 0 ? `${item.id}#due` : item.id);
      }

      for (const block of blocks) {
        const seriesExceptions = exceptions.get(item.id);
        if (block.recurrence) {
          const pseudo: Item = {
            ...item,
            start: block.start,
            end: block.end,
            recurrence: block.recurrence,
          };
          for (const inst of expandRecurrence(pseudo, from, to)) {
            if (seriesExceptions?.has(inst.originalStart)) continue;
            if (!overlaps(inst.start, inst.end, from, to)) continue;
            push({
              key: `${item.id}#${block.id}@${inst.originalStart}`,
              item,
              start: inst.start,
              end: inst.end,
              originalStart: inst.originalStart,
              isRecurring: true,
              isDue: false,
              blockId: block.id,
            });
          }
          continue;
        }
        if (!overlaps(block.start, block.end, from, to)) continue;
        push({
          key: `${item.id}#${block.id}`,
          item,
          start: block.start,
          end: block.end,
          isRecurring: false,
          isDue: false,
          blockId: block.id,
        });
      }
      continue;
    }

    if (item.recurrence) {
      const seriesExceptions = exceptions.get(item.id) ?? new Map<number, Item>();
      for (const inst of expandRecurrence(item, from, to)) {
        const exception = seriesExceptions.get(inst.originalStart);
        if (exception) continue; // replaced below, wherever it now lives
        if (!overlaps(inst.start, inst.end, from, to)) continue;
        push({
          key: `${item.id}@${inst.originalStart}`,
          item,
          start: inst.start,
          end: inst.end,
          originalStart: inst.originalStart,
          isRecurring: true,
          isDue: false,
        });
      }
      continue;
    }

    if (item.start == null) continue;
    const end = item.end ?? item.start;
    if (!overlaps(item.start, end, from, to)) continue;
    push({
      key: item.id,
      item,
      start: item.start,
      end,
      isRecurring: false,
      isDue: false,
    });
  }

  for (const item of live) {
    if (!item.recurrenceParentId || item.cancelled) continue;
    const start = item.start ?? item.dueAt;
    if (start == null) continue;
    const end = item.end ?? start;
    const isDue = item.type === "task" && item.start == null;
    if (!isDue && !overlaps(start, end, from, to)) continue;
    if (isDue && (start < from || start > to)) continue;
    const original = item.originalStart ?? start;
    push({
      key: `${item.recurrenceParentId}@${original}`,
      item,
      start,
      end,
      originalStart: original,
      isRecurring: true,
      isDue,
      ...(item.recurrenceBlockId ? { blockId: item.recurrenceBlockId } : {}),
    });
  }

  return out.sort((a, b) => a.start - b.start || Number(b.item.allDay) - Number(a.item.allDay));
}

/** Timed, non-due occurrences for one day, in start order. */
export function occurrencesOnDay(occs: Occurrence[], dayStart: number, dayEnd: number): Occurrence[] {
  return occs
    .filter((o) => !o.isDue && o.start < dayEnd && Math.max(o.end, o.start + 1) > dayStart)
    .sort((a, b) => a.start - b.start);
}
