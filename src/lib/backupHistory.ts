import { format } from "date-fns";
import type { HistoryEntry } from "./desktop";

/**
 * The history list is small enough to filter in the renderer. Searching covers
 * the names the snapshot indexed as well as the moment it was taken, so both
 * "organic" and "October 14" find the right row.
 */
export function filterHistory(
  entries: readonly HistoryEntry[],
  query: string,
): HistoryEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => {
    if (entry.titles.some((title) => title.toLowerCase().includes(needle))) {
      return true;
    }
    const when = new Date(entry.writtenAt);
    if (Number.isNaN(when.getTime())) return false;
    return [
      format(when, "yyyy-MM-dd"),
      format(when, "EEEE"),
      format(when, "d MMMM yyyy"),
      format(when, "HH:mm"),
      format(when, "h:mm a"),
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export function historySummary(entry: HistoryEntry): string {
  const plural = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;
  const parts = [plural(entry.items, "item")];
  if (entry.calendars) parts.push(plural(entry.calendars, "calendar"));
  if (entry.projects) parts.push(plural(entry.projects, "project"));
  if (entry.schedules) parts.push(plural(entry.schedules, "schedule"));
  if (entry.habits) parts.push(plural(entry.habits, "habit"));
  if (entry.goals) parts.push(plural(entry.goals, "goal"));
  return parts.join(" · ");
}
