import { format } from "date-fns";

/**
 * Every time the app prints goes through here. The reader chooses 12- or
 * 24-hour clocks once in Settings, and nothing else has to know which one it
 * is: labels, ranges, hour rulers and tooltips all take the same format.
 */
export type TimeFormat = "12h" | "24h";

/** "9:05 AM" or "09:05", the clock time of an instant. */
export function clockTime(ts: number, style: TimeFormat = "12h"): string {
  return format(ts, style === "24h" ? "HH:mm" : "h:mm a");
}

/** "9:05" or "09:05" — the compact form used inside dense calendar chips. */
export function clockShort(ts: number, style: TimeFormat = "12h"): string {
  return format(ts, style === "24h" ? "HH:mm" : "h:mm");
}

/** "9 AM" or "09:00", for hour rulers and day summaries. */
export function clockHour(hour: number, style: TimeFormat = "12h"): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  if (style === "24h") return `${String(h).padStart(2, "0")}:00`;
  return clockHourLabel(h, style);
}

/** "9 AM", "12 PM" or "09", for the hour column of a time field. */
export function clockHourLabel(hour: number, style: TimeFormat = "12h"): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  if (style === "24h") return String(h).padStart(2, "0");
  const suffix = h < 12 ? "AM" : "PM";
  return h % 12 === 0 ? `12 ${suffix}` : `${h % 12} ${suffix}`;
}

/** "9:05 AM" or "09:05" from minutes after midnight. */
export function clockMinutes(minutes: number, style: TimeFormat = "12h"): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (style === "24h") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * "19 Oct 2026 · 09:05" or "19 Oct 2026 · 9:05 AM". Tooltips and backup rows
 * need the date beside the clock, and both halves must share the setting.
 */
export function clockStamp(
  ts: number,
  style: TimeFormat = "12h",
  datePattern = "d MMM yyyy",
): string {
  return `${format(ts, datePattern)} · ${clockTime(ts, style)}`;
}

/** "9:00 AM – 10:00 AM" or "09:00 – 10:00". */
export function clockSpan(start: number, end: number, style: TimeFormat = "12h"): string {
  return `${clockTime(start, style)} – ${clockTime(end, style)}`;
}
