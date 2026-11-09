import { addDays, differenceInCalendarDays, endOfDay, startOfDay } from "date-fns";
import type { Item, Occurrence } from "../types";

/**
 * US federal holidays plus the observances that shape a normal week —
 * Valentine's, Halloween, Black Friday. Generated rather than stored: the
 * calendar can draw any year without seeding rows into the database, and
 * turning them off leaves nothing behind to clean up.
 */

export interface Holiday {
  key: string;
  name: string;
  /** Day start. */
  start: number;
  /** Day end (exclusive). */
  end: number;
  /** Federal days off read differently from popular observances. */
  federal: boolean;
}

const HOLIDAY_COLOR = "#7c8a99";

function day(year: number, month: number, date: number): number {
  return startOfDay(new Date(year, month, date)).getTime();
}

/** 1 = first Monday, -1 = last Monday. */
function nthWeekday(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): number {
  if (nth > 0) {
    const first = new Date(year, month, 1);
    const delta = (weekday - first.getDay() + 7) % 7;
    return day(year, month, 1 + delta + (nth - 1) * 7);
  }
  const last = new Date(year, month + 1, 0);
  const delta = (last.getDay() - weekday + 7) % 7;
  return day(year, month, last.getDate() - delta);
}

/** Western Easter, by the anonymous Gregorian algorithm. */
function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const date = ((h + l - 7 * m + 114) % 31) + 1;
  return day(year, month - 1, date);
}

function yearHolidays(year: number): Holiday[] {
  const thanksgiving = nthWeekday(year, 10, 4, 4);
  const blackFriday = day(year, 10, new Date(thanksgiving).getDate() + 1);
  return [
    { key: "new-year", name: "New Year's Day", start: day(year, 0, 1), federal: true },
    { key: "mlk", name: "Martin Luther King Jr. Day", start: nthWeekday(year, 0, 1, 3), federal: true },
    { key: "valentines", name: "Valentine's Day", start: day(year, 1, 14), federal: false },
    { key: "presidents", name: "Presidents' Day", start: nthWeekday(year, 1, 1, 3), federal: true },
    { key: "st-patrick", name: "St. Patrick's Day", start: day(year, 2, 17), federal: false },
    { key: "easter", name: "Easter Sunday", start: easter(year), federal: false },
    { key: "mothers", name: "Mother's Day", start: nthWeekday(year, 4, 0, 2), federal: false },
    { key: "memorial", name: "Memorial Day", start: nthWeekday(year, 4, 1, -1), federal: true },
    { key: "fathers", name: "Father's Day", start: nthWeekday(year, 5, 0, 3), federal: false },
    { key: "juneteenth", name: "Juneteenth", start: day(year, 5, 19), federal: true },
    { key: "independence", name: "Independence Day", start: day(year, 6, 4), federal: true },
    { key: "labor", name: "Labor Day", start: nthWeekday(year, 8, 1, 1), federal: true },
    { key: "columbus", name: "Columbus Day", start: nthWeekday(year, 9, 1, 2), federal: true },
    { key: "halloween", name: "Halloween", start: day(year, 9, 31), federal: false },
    { key: "veterans", name: "Veterans Day", start: day(year, 10, 11), federal: true },
    { key: "thanksgiving", name: "Thanksgiving", start: thanksgiving, federal: true },
    { key: "black-friday", name: "Black Friday", start: blackFriday, federal: false },
    { key: "cyber-monday", name: "Cyber Monday", start: addDays(blackFriday, 3).getTime(), federal: false },
    { key: "christmas-eve", name: "Christmas Eve", start: day(year, 11, 24), federal: false },
    { key: "christmas", name: "Christmas Day", start: day(year, 11, 25), federal: true },
    { key: "new-years-eve", name: "New Year's Eve", start: day(year, 11, 31), federal: false },
  ].map((holiday) => ({
    ...holiday,
    end: addDays(holiday.start, 1).getTime(),
  }));
}

/** Every holiday whose day touches the requested range. */
export function holidaysBetween(from: number, to: number): Holiday[] {
  const firstYear = new Date(from).getFullYear();
  const lastYear = new Date(to).getFullYear();
  const out: Holiday[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    for (const holiday of yearHolidays(year)) {
      if (holiday.start <= to && holiday.end > from) out.push(holiday);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Holidays as calendar occurrences. They are read-only: the synthetic item has
 * no edit path in the UI, and `holiday` lets the views style and open them
 * without treating them as user data.
 */
export function holidayOccurrences(from: number, to: number): Occurrence[] {
  const now = Date.now();
  return holidaysBetween(from, to).map((holiday) => {
    const item: Item = {
      id: `holiday:${holiday.key}:${new Date(holiday.start).getFullYear()}`,
      type: "event",
      title: holiday.name,
      allDay: true,
      start: holiday.start,
      end: holiday.end,
      color: HOLIDAY_COLOR,
      createdAt: now,
      updatedAt: now,
    };
    return {
      key: item.id,
      item,
      start: holiday.start,
      end: holiday.end,
      isRecurring: false,
      holiday: true,
    };
  });
}

/** Used by the Today view and widgets to describe the day in one line. */
export function holidayLabelOn(dayStart: number): string | null {
  const dayEnd = endOfDay(dayStart).getTime();
  return holidaysBetween(dayStart, dayEnd)[0]?.name ?? null;
}

/** Whole days between two day starts; kept here for callers that lay out months. */
export function daysBetween(a: number, b: number): number {
  return differenceInCalendarDays(b, a);
}
