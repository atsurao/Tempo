import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { clockTime, type TimeFormat } from "./clock";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function sod(ts: number): number {
  return startOfDay(ts).getTime();
}
export function eod(ts: number): number {
  return endOfDay(ts).getTime();
}

/** One hour later, unless that would cross local midnight. */
export function hourLaterSameDay(ts: number): number {
  const next = ts + HOUR;
  return isSameDay(next, ts) ? next : ts;
}

export function weekStartDate(ts: number, weekStartsOn: 0 | 1): Date {
  return startOfWeek(ts, { weekStartsOn });
}

export function monthGridRange(ts: number, weekStartsOn: 0 | 1): { from: number; to: number } {
  const first = startOfWeek(startOfMonth(ts), { weekStartsOn });
  const last = endOfWeek(endOfMonth(ts), { weekStartsOn });
  return { from: first.getTime(), to: endOfDay(last).getTime() };
}

/**
 * The grid range covering `count` whole months, starting with the month that
 * contains `from`. The month view renders months back to back, so its fetch
 * range is the same shape whether it shows one month or many.
 */
export function monthSpanRange(
  from: number,
  count: number,
  weekStartsOn: 0 | 1,
): { from: number; to: number } {
  const first = startOfWeek(startOfMonth(from), { weekStartsOn });
  const lastMonth = startOfMonth(addMonths(new Date(from), count - 1).getTime());
  const last = endOfWeek(endOfMonth(lastMonth), { weekStartsOn });
  return { from: first.getTime(), to: endOfDay(last).getTime() };
}

/** Calendar year containing `ts`, padded to whole days. */
export function yearRange(ts: number): { from: number; to: number } {
  return { from: startOfYear(ts).getTime(), to: endOfDay(endOfYear(ts)).getTime() };
}

/**
 * Calendar years to keep rendered around `year`: `span` on each side.
 * The year view scrolls through them as one page per year.
 */
export function yearWindow(year: number, span: number): { from: number; to: number } {
  return { from: year - span, to: year + span };
}

/** Every day of the inclusive year range `from`–`to`, padded to whole days. */
export function yearSpanRange(from: number, to: number): { from: number; to: number } {
  const first = startOfYear(new Date(from, 0, 1));
  const last = endOfYear(new Date(to, 0, 1));
  return { from: first.getTime(), to: endOfDay(last).getTime() };
}

export function rangeLabel(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()) {
    return format(a, "MMM d, yyyy");
  }
  if (a.getFullYear() !== b.getFullYear()) {
    return `${format(a, "MMM d, yyyy")} – ${format(b, "MMM d, yyyy")}`;
  }
  if (a.getMonth() !== b.getMonth()) {
    return `${format(a, "MMM d")} – ${format(b, "MMM d, yyyy")}`;
  }
  return `${format(a, "MMM d")} – ${format(b, "d, yyyy")}`;
}

export function timeLabel(ts: number, allDay?: boolean, style: TimeFormat = "12h"): string {
  if (allDay) return "All day";
  return clockTime(ts, style);
}

export function shortDate(ts: number, now = Date.now()): string {
  const days = differenceInCalendarDays(sod(ts), sod(now));
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return format(ts, "EEEE");
  if (new Date(ts).getFullYear() === new Date(now).getFullYear()) return format(ts, "MMM d");
  return format(ts, "MMM d, yyyy");
}

/** Convert an absolute timestamp to minutes from midnight, local time. */
export function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/** Build a timestamp on the given day (start-of-day ms) at a minute offset. */
export function atMinutes(dayStart: number, minutes: number): number {
  return dayStart + minutes * MINUTE;
}

export function snap(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step;
}

export function durationLabel(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function humanDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** "in 12 minutes", "in 2h 5m", "now", "10 min ago" */
export function relativeLabel(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / MINUTE);
  let text: string;
  if (mins < 1) text = "now";
  else if (mins < 60) text = `${mins}m`;
  else if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    text = m ? `${h}h ${m}m` : `${h}h`;
  } else {
    const d = Math.round(mins / 1440);
    text = `${d}d`;
  }
  if (text === "now") return text;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export function isToday(ts: number, now = Date.now()): boolean {
  return isSameDay(ts, now);
}

export {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  startOfYear,
  endOfYear,
  format,
  isSameDay,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
};
