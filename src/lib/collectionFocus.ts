import type {
  Item,
  Occurrence,
  Schedule,
  ScheduleBreak,
  ScheduleException,
  ScheduleItem,
} from "../types";
import { DAY, sod } from "./date";
import { buildScheduleOccurrences } from "./schedule";

/** A collection the calendar briefly lights up after it is chosen. */
export interface CollectionHighlight {
  kind: "calendar" | "schedule";
  id: string;
  nonce: number;
  expiresAt: number;
}

/**
 * The date a calendar should be opened on: its next live item, or its most
 * recent one when everything is already in the past. That way a click never
 * lands on an empty week.
 */
export function nextCalendarDate(
  items: Item[],
  calendarId: string,
  now = Date.now(),
): number | null {
  const dates = items
    .filter(
      (item) =>
        !item.deletedAt &&
        item.projectId === calendarId &&
        (item.type === "event" || item.type === "task"),
    )
    .map((item) => item.start ?? item.dueAt ?? null)
    .filter((ts): ts is number => ts != null)
    .sort((a, b) => a - b);
  if (dates.length === 0) return null;
  const today = sod(now);
  return dates.find((ts) => ts >= today) ?? dates[dates.length - 1];
}

/** The first session of a timetable on or after today, if it has one. */
export function nextScheduleDate(
  schedule: Schedule,
  items: ScheduleItem[],
  breaks: ScheduleBreak[],
  now = Date.now(),
  exceptions: ScheduleException[] = [],
): number | null {
  const from = Math.max(sod(now), sod(schedule.from));
  const to = Math.min(
    sod(schedule.to),
    from + 366 * DAY,
  );
  if (to < from) return sod(schedule.from);
  const occurrences = buildScheduleOccurrences(
    { schedules: [schedule], items, breaks, exceptions },
    from,
    to + DAY - 1,
  ).sort((a, b) => a.start - b.start);
  return occurrences[0]?.start ?? null;
}

/** Does this drawn occurrence belong to the collection being highlighted? */
export function isHighlightedOccurrence(
  occ: Occurrence,
  highlight: CollectionHighlight | null | undefined,
): boolean {
  if (!highlight) return false;
  if (highlight.kind === "schedule") return occ.scheduleId === highlight.id;
  return !occ.scheduleId && occ.item.projectId === highlight.id;
}
