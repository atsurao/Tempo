import { addDays, format, setHours, setMinutes, startOfDay } from "date-fns";
import type { Priority } from "../types";
import { clockTime, type TimeFormat } from "./clock";

export interface ParsedInput {
  title: string;
  type: "event" | "task";
  start: number | null;
  end: number | null;
  dueAt: number | null;
  estimateMin: number | null;
  tagNames: string[];
  priority: Priority;
  projectName?: string;
  allDay: boolean;
  /** short human summary for the preview line */
  summary: string[];
}

const WEEKDAY: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

function stripRanges(text: string, ranges: [number, number][]): string {
  let out = "";
  let cursor = 0;
  for (const [start, end] of mergeRanges(ranges)) {
    out += text.slice(cursor, start) + " ";
    cursor = end;
  }
  out += text.slice(cursor);
  return out
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, "")
    .trim();
}

export function parseQuickAdd(
  input: string,
  now = Date.now(),
  style: TimeFormat = "12h",
): ParsedInput {
  const text = input;
  const ranges: [number, number][] = [];
  const summary: string[] = [];
  let tagNames: string[] = [];
  let projectName: string | undefined;
  let priority: Priority = 0;
  let durationMin: number | null = null;
  let hour: number | null = null;
  let minute = 0;
  let day: Date | null = null;
  let allDay = false;

  const take = (m: RegExpExecArray) => ranges.push([m.index, m.index + m[0].length]);

  // #tags
  const tagRe = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
  for (let m = tagRe.exec(text); m; m = tagRe.exec(text)) {
    tagNames.push(m[1]);
    take(m);
  }

  // @project
  const projectRe = /(?:^|\s)@([\p{L}\p{N}_-]+)/u;
  const projectMatch = projectRe.exec(text);
  if (projectMatch) {
    projectName = projectMatch[1];
    take(projectMatch);
  }

  // !priority  (!1 = high, !3 = low)
  const prioMatch = /(?:^|\s)!([1-3])\b/.exec(text);
  if (prioMatch) {
    priority = (4 - Number(prioMatch[1])) as Priority;
    take(prioMatch);
  }

  // duration: "90m", "for 1.5h", "2 hours"
  const durMatch = /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i.exec(text);
  if (durMatch) {
    const value = Number(durMatch[1]);
    const unit = durMatch[2].toLowerCase();
    durationMin = Math.round(unit.startsWith("h") ? value * 60 : value);
    take(durMatch);
  }

  // time: "2pm", "2:30 pm", "14:00"
  const timeRe = /(?:^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
  const timeMatch = timeRe.exec(text);
  if (timeMatch) {
    let h = Number(timeMatch[1]) % 12;
    if (timeMatch[3].toLowerCase() === "pm") h += 12;
    hour = h;
    minute = Number(timeMatch[2] ?? 0);
    take(timeMatch);
  } else {
    const military = /(?:^|\s)(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
    if (military) {
      hour = Number(military[1]);
      minute = Number(military[2]);
      take(military);
    }
  }

  // relative days and weekdays
  const inDays = /\bin\s+(\d+)\s+(days?|weeks?)\b/i.exec(text);
  const nextWeekday = /\bnext\s+(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?\b/i.exec(text);
  const weekday = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|s)?\b/i.exec(text);
  const tomorrow = /\b(tomorrow|tmrw|tom)\b/i.exec(text);
  const todayWord = /\b(today|tonight)\b/i.exec(text);
  const monthDay = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i.exec(text);
  const numericDate = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);

  const base = startOfDay(now);

  if (inDays) {
    const n = Number(inDays[1]);
    day = addDays(base, inDays[2].toLowerCase().startsWith("week") ? n * 7 : n);
    take(inDays);
  } else if (nextWeekday) {
    const target = WEEKDAY[nextWeekday[1].toLowerCase()];
    const current = new Date(now).getDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    day = addDays(base, delta);
    take(nextWeekday);
  } else if (monthDay) {
    const month = MONTHS[monthDay[1].toLowerCase()];
    const date = Number(monthDay[2]);
    let year = new Date(now).getFullYear();
    let candidate = new Date(year, month, date);
    if (candidate.getTime() < base.getTime()) {
      year += 1;
      candidate = new Date(year, month, date);
    }
    day = candidate;
    take(monthDay);
  } else if (numericDate) {
    const a = Number(numericDate[1]);
    const b = Number(numericDate[2]);
    const month = Math.min(Math.max(a, 1), 12) - 1;
    const date = Math.min(Math.max(b, 1), 31);
    let year = numericDate[3] ? Number(numericDate[3]) : new Date(now).getFullYear();
    if (year < 100) year += 2000;
    let candidate = new Date(year, month, date);
    if (candidate.getTime() < base.getTime()) candidate = new Date(year + 1, month, date);
    day = candidate;
    take(numericDate);
  } else if (tomorrow) {
    day = addDays(base, 1);
    take(tomorrow);
  } else if (todayWord) {
    day = base;
    if (todayWord[1].toLowerCase() === "tonight") {
      hour = hour ?? 20;
      minute = 0;
    }
    take(todayWord);
  } else if (weekday) {
    const target = WEEKDAY[weekday[1].toLowerCase()];
    const current = new Date(now).getDay();
    const delta = (target - current + 7) % 7;
    day = addDays(base, delta);
    take(weekday);
  }

  const title = stripRanges(text, ranges) || input.trim();

  let start: number | null = null;
  let end: number | null = null;
  let dueAt: number | null = null;
  let type: ParsedInput["type"] = "task";

  if (hour != null) {
    const anchor = day ?? base;
    start = setMinutes(setHours(anchor, hour), minute).getTime();
    end = start + (durationMin ?? 60) * 60_000;
    type = "event";
    summary.push(
      `${format(start, day ? "EEE, MMM d" : "MMM d")} · ${clockTime(start, style)}`,
    );
    summary.push(`${durationMin ?? 60} min`);
  } else if (day) {
    if (allDay) {
      start = day.getTime();
      end = day.getTime() + 24 * 60 * 60_000;
      type = "event";
    } else {
      dueAt = setMinutes(setHours(day, 23), 59).getTime();
      summary.push(`Due ${format(day, "EEE, MMM d")}`);
    }
  }

  if (durationMin != null && !start) {
    summary.push(`${durationMin} min estimate`);
  }
  if (type === "event" && !summary.length) summary.push("Event");
  if (tagNames.length) summary.push(tagNames.map((t) => `#${t}`).join(" "));
  if (projectName) summary.push(`@${projectName}`);
  if (priority) summary.push(priority === 3 ? "High priority" : priority === 2 ? "Medium priority" : "Low priority");

  return {
    title,
    type,
    start,
    end,
    dueAt,
    estimateMin: durationMin,
    tagNames,
    priority,
    projectName,
    allDay,
    summary,
  };
}
