import type { Habit, HabitCheckin } from "../types";
import { DAY, sod } from "./date";

/**
 * Habits repeat on a weekly pattern and are measured one day at a time. This is
 * where "is it due today?", "is it done?" and "how long is the streak?" live,
 * so the pane and any future calendar marker agree.
 */

/** How far back a streak is willing to look. */
const STREAK_LOOKBACK_DAYS = 366;

export function checkinId(habitId: string, day: number): string {
  return `${habitId}:${sod(day)}`;
}

export function isHabitDue(habit: Habit, dayKey: number): boolean {
  if (habit.archivedAt) return false;
  const day = sod(dayKey);
  if (day < sod(habit.start)) return false;
  if (!habit.days.includes(new Date(day).getDay())) return false;
  const interval = Math.max(1, habit.interval || 1);
  if (interval === 1) return true;
  // Align every N weeks on the week that holds the habit's first day.
  const weeks = Math.round((sod(day) - sod(habit.start)) / (7 * DAY));
  return ((weeks % interval) + interval) % interval === 0;
}

/** Which habits run on a day, in rail order. */
export function habitsDueOn(habits: Habit[], dayKey: number): Habit[] {
  return habits
    .filter((habit) => isHabitDue(habit, dayKey))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

const doneKey = (habitId: string, day: number) => `${habitId}:${sod(day)}`;

/** A lookup of the days already done, so a week strip needs one pass. */
export function doneDays(checkins: HabitCheckin[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const checkin of checkins) map.set(doneKey(checkin.habitId, checkin.day), checkin.day);
  return map;
}

export function isHabitDone(
  checkins: HabitCheckin[] | Map<string, number>,
  habitId: string,
  dayKey: number,
): boolean {
  if (checkins instanceof Map) return checkins.has(doneKey(habitId, dayKey));
  return checkins.some((c) => c.habitId === habitId && sod(c.day) === sod(dayKey));
}

/**
 * Consecutive scheduled days completed, counting back from today. A day that
 * has not been ticked yet does not break the streak until it is over, so a
 * streak is still 12 at breakfast rather than 0.
 */
export function habitStreak(
  habit: Habit,
  checkins: HabitCheckin[] | Map<string, number>,
  now = Date.now(),
): number {
  if (habit.days.length === 0) return 0;
  const done = checkins instanceof Map ? checkins : doneDays(checkins);
  const today = sod(now);
  let streak = 0;
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    const day = sod(today - i * DAY);
    if (!isHabitDue(habit, day)) continue;
    if (isHabitDone(done, habit.id, day)) {
      streak++;
      continue;
    }
    // Today still has hours left; it is pending, not missed.
    if (day === today) continue;
    break;
  }
  return streak;
}

export interface HabitDay {
  day: number;
  due: boolean;
  done: boolean;
}

/** One row of the last `count` days, oldest first, ending today. */
export function recentDays(
  habit: Habit,
  checkins: HabitCheckin[] | Map<string, number>,
  count = 7,
  now = Date.now(),
): HabitDay[] {
  const done = checkins instanceof Map ? checkins : doneDays(checkins);
  const today = sod(now);
  return Array.from({ length: count }, (_, i) => {
    const day = sod(today - (count - 1 - i) * DAY);
    return {
      day,
      due: isHabitDue(habit, day),
      done: isHabitDone(done, habit.id, day),
    };
  });
}

/** How often a habit runs, in the words the pane uses. */
export function habitSummary(habit: Habit): string {
  const interval = Math.max(1, habit.interval || 1);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = [...new Set(habit.days)].sort((a, b) => a - b);
  if (days.length === 7) return interval === 1 ? "Every day" : `Every ${interval} weeks`;
  if (days.length === 0) return "No days set";
  if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) {
    return interval === 1 ? "Weekdays" : `Every ${interval} weeks, weekdays`;
  }
  if (days.length === 2 && days[0] === 0 && days[1] === 6) {
    return interval === 1 ? "Weekends" : `Every ${interval} weekends`;
  }
  const list = days.map((d) => names[d]).join(", ");
  return interval === 1 ? `Every ${list}` : `Every ${interval} weeks on ${list}`;
}

/** Completion across the last `count` scheduled days, as a percentage. */
export function habitCompletion(
  habit: Habit,
  checkins: HabitCheckin[] | Map<string, number>,
  count = 30,
  now = Date.now(),
): { due: number; done: number; pct: number } {
  const done = checkins instanceof Map ? checkins : doneDays(checkins);
  let due = 0;
  let hits = 0;
  for (let i = 0; i < count; i++) {
    const day = sod(sod(now) - i * DAY);
    if (!isHabitDue(habit, day)) continue;
    due++;
    if (isHabitDone(done, habit.id, day)) hits++;
  }
  return { due, done: hits, pct: due === 0 ? 0 : Math.round((hits / due) * 100) };
}

/** The next day this habit runs on or after `from`, or null within a year. */
export function nextHabitDay(habit: Habit, from = Date.now()): number | null {
  const start = sod(from);
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    const day = sod(start + i * DAY);
    if (isHabitDue(habit, day)) return day;
  }
  return null;
}

/** Default weekdays for a new habit: every day. */
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;
