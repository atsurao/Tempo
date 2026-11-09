import type {
  Item,
  Occurrence,
  Schedule,
  ScheduleBreak,
  ScheduleException,
  ScheduleItem,
} from "../types";
import { DAY, MINUTE, sod } from "./date";

/**
 * Turning a weekly timetable into calendar occurrences.
 *
 * A schedule is not a set of events: it is a pattern that repeats every week
 * until a break says otherwise. The views only understand occurrences, so the
 * pattern is expanded here, over the days a view is actually showing, and each
 * session is dressed as an item the existing rows and chips already know how
 * to draw. Nothing is written to the database, so editing the timetable changes
 * every future week at once.
 */

/** Ids of the items standing in for sessions, so a view can tell them apart. */
export const SCHEDULE_ITEM_PREFIX = "sched:";

/**
 * The least a break needs to be drawn, counted or listed: its name, where it
 * starts and where it ends. Editors hold drafts that are not rows yet, so the
 * helpers here ask for no more than they use.
 */
export type BreakSpan = Pick<ScheduleBreak, "id" | "label" | "from" | "to">;

/** How many minutes a session lasts if its end is missing or before its start. */
const FALLBACK_LENGTH = 60;

export function isScheduleItemId(id: string): boolean {
  return id.startsWith(SCHEDULE_ITEM_PREFIX);
}

/** Ids of the schedules the reader has hidden. */
export function hiddenScheduleIds(schedules: Schedule[]): Set<string> {
  const ids = new Set<string>();
  for (const schedule of schedules) {
    if (schedule.hidden) ids.add(schedule.id);
  }
  return ids;
}

/**
 * The schedules a view draws. Hiding is a view preference, not an edit: a
 * hidden timetable keeps its sessions, breaks and editor, and simply takes its
 * occurrences out of the calendar and Today until it is shown again.
 */
export function visibleSchedules(schedules: Schedule[]): Schedule[] {
  if (!schedules.some((schedule) => schedule.hidden)) return schedules;
  return schedules.filter((schedule) => !schedule.hidden);
}

/** Weekday names, Monday first, for the editor's day toggles. */
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** The weekdays in the order the app shows them, given its first day of week. */
export function orderedWeekdays(weekStartsOn: 0 | 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
}

/** "09:30" → 570. Empty or malformed input reads as midnight. */
export function parseClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  const hours = Math.min(23, Number(match[1]));
  const minutes = Math.min(59, Number(match[2]));
  return hours * 60 + minutes;
}

/** 570 → "09:30", and 1440 → "24:00". */
export function formatClock(minutes: number): string {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 570 → "9:30 AM", for summaries. */
export function clockLabel(minutes: number): string {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h} ${suffix}` : `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** The end of a session, never before its start and never past midnight. */
export function sessionEnd(item: Pick<ScheduleItem, "startMin" | "endMin">): number {
  const start = Math.max(0, Math.min(24 * 60, item.startMin));
  const end = item.endMin > start ? item.endMin : start + FALLBACK_LENGTH;
  return Math.max(start, Math.min(24 * 60, end));
}

/** A day is out of timetable when any break of that schedule covers it. */
export function onBreak(breaks: BreakSpan[], dayKey: number): boolean {
  for (const brk of breaks) {
    if (dayKey >= sod(brk.from) && dayKey <= sod(brk.to)) return true;
  }
  return false;
}

/** The item a session is drawn as: a plain event in the schedule's color. */
export function sessionItem(session: ScheduleItem, schedule: Schedule): Item {
  return {
    id: `${SCHEDULE_ITEM_PREFIX}${session.id}`,
    type: "event",
    title: session.name,
    location: session.location || undefined,
    color: schedule.color,
    allDay: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Whole days from `from`'s start of day to `to`'s, inclusive. The cursor walks
 * by calendar date rather than by 24 hours: a term that crosses a clock change
 * would otherwise meet one day twice and skip the next.
 */
function daysBetween(from: number, to: number): number[] {
  const out: number[] = [];
  const last = sod(to);
  const cursor = new Date(sod(from));
  while (cursor.getTime() <= last) {
    out.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export interface Timetable {
  schedules: Schedule[];
  items: ScheduleItem[];
  breaks: ScheduleBreak[];
  exceptions?: ScheduleException[];
}

/** One deterministic row per session/day, so two edits cannot duplicate it. */
export function scheduleExceptionId(sessionId: string, day: number): string {
  return `sx:${sessionId}:${sod(day)}`;
}

/** True when the term covers this day. Both endpoints are included. */
export function runsOn(schedule: Schedule, dayKey: number): boolean {
  return dayKey >= sod(schedule.from) && dayKey <= sod(schedule.to);
}

/** Days a break lasts, counting both of its endpoints. */
export function breakDays(brk: Pick<BreakSpan, "from" | "to">): number {
  const from = sod(brk.from);
  const to = Math.max(from, sod(brk.to));
  return Math.round((to - from) / DAY) + 1;
}

/** "Oct 26 – Oct 30" for a break, however long it is. */
export function breakRangeLabel(brk: Pick<BreakSpan, "from" | "to">): string {
  const from = new Date(sod(brk.from));
  const to = new Date(Math.max(sod(brk.from), sod(brk.to)));
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (from.getTime() === to.getTime()) return month(from);
  if (from.getFullYear() !== to.getFullYear()) {
    return `${month(from)}, ${from.getFullYear()} – ${month(to)}, ${to.getFullYear()}`;
  }
  return `${month(from)} – ${month(to)}`;
}

/** "Mon, Oct 26 – Fri, Oct 30" — a break named by the weekdays it takes out. */
export function breakDaysLabel(brk: Pick<BreakSpan, "from" | "to">): string {
  const from = new Date(sod(brk.from));
  const to = new Date(Math.max(sod(brk.from), sod(brk.to)));
  const sameYear = from.getFullYear() === to.getFullYear();
  const day = (d: Date) =>
    d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" as const }),
    });
  if (from.getTime() === to.getTime()) return day(from);
  return `${day(from)} – ${day(to)}`;
}

/** Days a break takes out of the term, counting only the days inside it. */
export function breakDaysInTerm(schedule: Pick<Schedule, "from" | "to">, brk: Pick<BreakSpan, "from" | "to">): number {
  const termStart = sod(schedule.from);
  const termEnd = Math.max(termStart, sod(schedule.to));
  const from = Math.max(termStart, sod(brk.from));
  const to = Math.min(termEnd, Math.max(sod(brk.from), sod(brk.to)));
  if (to < from) return 0;
  return Math.round((to - from) / DAY) + 1;
}

/** Days off across a term: the breaks inside it, however they overlap. */
export function daysOffInTerm(schedule: Pick<Schedule, "from" | "to">, breaks: Pick<BreakSpan, "from" | "to">[]): number {
  return breaks.reduce((sum, brk) => sum + breakDaysInTerm(schedule, brk), 0);
}

/**
 * Breaks grouped by the month they start in, earliest first. A term is read
 * like a term calendar — October's breaks under October — and a break that
 * straddles a month boundary belongs to the month it begins in.
 */
export function breaksByMonth<B extends Pick<BreakSpan, "from">>(
  breaks: B[],
): { key: string; label: string; breaks: B[] }[] {
  const groups = new Map<string, { key: string; label: string; breaks: B[] }>();
  for (const brk of [...breaks].sort((a, b) => a.from - b.from)) {
    const start = new Date(sod(brk.from));
    const key = `${start.getFullYear()}-${String(start.getMonth()).padStart(2, "0")}`;
    const group = groups.get(key);
    if (group) {
      group.breaks.push(brk);
      continue;
    }
    groups.set(key, {
      key,
      label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      breaks: [brk],
    });
  }
  return [...groups.values()];
}

/** A break drawn along a term strip, as fractions of the term's width. */
export interface TermBreakSpan<B extends BreakSpan = ScheduleBreak> {
  brk: B;
  /** 0 at the term's first day, 1 at the end of its last. */
  left: number;
  right: number;
  /** true when part of the break falls outside the term */
  clipped: boolean;
}

/** Break positions along the term, so a strip can show the year at a glance. */
export function termBreakSpans<B extends BreakSpan>(
  schedule: Pick<Schedule, "from" | "to">,
  breaks: B[],
): TermBreakSpan<B>[] {
  const start = sod(schedule.from);
  const end = Math.max(start, sod(schedule.to));
  const total = end - start + DAY;
  const out: TermBreakSpan<B>[] = [];
  for (const brk of breaks) {
    const b0 = sod(brk.from);
    const b1 = Math.max(b0, sod(brk.to));
    if (b1 < start || b0 > end) continue;
    const from = Math.max(b0, start);
    const to = Math.min(b1, end);
    out.push({
      brk,
      left: (from - start) / total,
      right: (to - start + DAY) / total,
      clipped: b0 < start || b1 > end,
    });
  }
  return out.sort((a, b) => a.left - b.left);
}

/** Month boundaries along the term, for the labels under a term strip. */
export function termMonths(
  schedule: Pick<Schedule, "from" | "to">,
): { key: string; label: string; left: number }[] {
  const start = sod(schedule.from);
  const end = Math.max(start, sod(schedule.to));
  const total = end - start + DAY;
  const out: { key: string; label: string; left: number }[] = [];
  const cursor = new Date(start);
  cursor.setDate(1);
  // The term's own month is where a reader looks first, so it leads the list
  // even when the term begins in the middle of it.
  while (cursor.getTime() <= end) {
    const monthStart = cursor.getTime();
    const visible = Math.max(monthStart, start);
    out.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: cursor.toLocaleDateString(undefined, { month: "short" }),
      left: (visible - start) / total,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/**
 * Every session falling inside [from, to], one occurrence per day it runs on,
 * skipping the days its schedule is on a break.
 */
export function buildScheduleOccurrences(data: Timetable, from: number, to: number): Occurrence[] {
  if (data.schedules.length === 0 || data.items.length === 0) return [];
  if (to < from) return [];

  const bySchedule = new Map<string, Schedule>();
  for (const schedule of data.schedules) bySchedule.set(schedule.id, schedule);

  // Sessions bucketed by weekday: a week view asks about days, not about the
  // whole timetable, and a year view asks about rather a lot of days.
  const byWeekday = new Map<number, { session: ScheduleItem; schedule: Schedule }[]>();
  for (const session of data.items) {
    const schedule = bySchedule.get(session.scheduleId);
    if (!schedule) continue;
    for (const day of new Set(session.days)) {
      if (day < 0 || day > 6) continue;
      const bucket = byWeekday.get(day);
      const entry = { session, schedule };
      if (bucket) bucket.push(entry);
      else byWeekday.set(day, [entry]);
    }
  }

  const breaksBySchedule = new Map<string, ScheduleBreak[]>();
  for (const brk of data.breaks) {
    const list = breaksBySchedule.get(brk.scheduleId);
    if (list) list.push(brk);
    else breaksBySchedule.set(brk.scheduleId, [brk]);
  }

  const exceptions = new Map<string, ScheduleException>();
  for (const row of data.exceptions ?? []) {
    exceptions.set(scheduleExceptionId(row.sessionId, row.day), row);
  }

  const out: Occurrence[] = [];
  for (const day of daysBetween(from, to)) {
    const bucket = byWeekday.get(new Date(day).getDay());
    if (!bucket) continue;
    for (const { session, schedule } of bucket) {
      // A timetable only runs inside its term, and never during a break.
      if (!runsOn(schedule, day)) continue;
      const breaks = breaksBySchedule.get(schedule.id);
      if (breaks && breaks.length > 0 && onBreak(breaks, day)) continue;
      const exception = exceptions.get(scheduleExceptionId(session.id, day));
      if (exception?.kind === "delete") continue;
      const edited = exception?.kind === "edit";
      const startMin = edited
        ? Math.max(0, Math.min(24 * 60, exception.startMin ?? session.startMin))
        : Math.max(0, Math.min(24 * 60, session.startMin));
      const endMin = sessionEnd({
        startMin,
        endMin: edited ? (exception.endMin ?? session.endMin) : session.endMin,
      });
      const start = day + startMin * MINUTE;
      const end = day + endMin * MINUTE;
      if (end <= from || start > to) continue;
      const item = sessionItem(session, schedule);
      if (edited) {
        if (exception.title !== undefined) item.title = exception.title;
        item.location = exception.location?.trim() || undefined;
      }
      out.push({
        key: `${SCHEDULE_ITEM_PREFIX}${session.id}@${day}`,
        item,
        start,
        end,
        isRecurring: true,
        scheduleId: schedule.id,
        scheduleItemId: session.id,
        scheduleDay: day,
      });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Item rows of one schedule, in the order the editor should show them. */
export function sessionsOf(items: ScheduleItem[], scheduleId: string): ScheduleItem[] {
  return items
    .filter((i) => i.scheduleId === scheduleId)
    .sort((a, b) => a.order - b.order || a.startMin - b.startMin);
}

/** Breaks of one schedule, earliest first. */
export function breaksOf(breaks: ScheduleBreak[], scheduleId: string): ScheduleBreak[] {
  return breaks
    .filter((b) => b.scheduleId === scheduleId)
    .sort((a, b) => a.from - b.from);
}

/** How many days a term covers, counting both of its endpoints. */
export function termDays(schedule: Pick<Schedule, "from" | "to">): number {
  const from = sod(schedule.from);
  const to = Math.max(from, sod(schedule.to));
  return Math.round((to - from) / DAY) + 1;
}

/** "Sep 8 – Dec 11, 2026", the term as a term calendar prints it. */
export function termRangeLabel(schedule: Pick<Schedule, "from" | "to">): string {
  const from = new Date(sod(schedule.from));
  const to = new Date(Math.max(sod(schedule.from), sod(schedule.to)));
  const day = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day(from)} – ${day(to)}, ${to.getFullYear()}`;
}

/**
 * The next day a schedule runs on or after `dayKey`, ignoring breaks: tells a
 * reader when the timetable comes back.
 */
export function nextRunningDay(
  items: ScheduleItem[],
  scheduleId: string,
  dayKey: number,
  schedule?: Schedule,
): number | null {
  const days = new Set(sessionsOf(items, scheduleId).flatMap((s) => s.days));
  if (days.size === 0) return null;
  const last = schedule ? sod(schedule.to) : Infinity;
  for (let i = 0; i < 7; i++) {
    const day = dayKey + i * DAY;
    if (day > last) return null;
    if (days.has(new Date(day).getDay())) return day;
  }
  return null;
}

/** "3 sessions · 2 breaks · Sep 8 – Dec 11", the line under a schedule's name. */
export function scheduleSummary(
  schedule: Schedule,
  items: ScheduleItem[],
  breaks: ScheduleBreak[],
): string {
  const sessions = sessionsOf(items, schedule.id);
  const brks = breaksOf(breaks, schedule.id);
  const day = (ts: number) => new Date(sod(ts)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
  const parts = [
    plural(sessions.length, "session"),
    plural(brks.length, "break"),
    `${day(schedule.from)} – ${day(schedule.to)}`,
  ];
  return parts.join(" · ");
}
