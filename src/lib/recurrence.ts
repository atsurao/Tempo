import { RRule } from "rrule";
import type { Item } from "../types";

/**
 * Recurrence is expanded in "floating" local time: a 9:00 class stays at 9:00
 * across DST changes instead of drifting an hour. rrule.js does its math in
 * UTC, so we shift local components into UTC, expand, then shift back.
 */
function toFloating(ms: number): Date {
  const d = new Date(ms);
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0),
  );
}

function fromFloating(d: Date): number {
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    0,
  ).getTime();
}

export interface ExpandedInstance {
  start: number;
  end: number;
  /** the occurrence start dictated by the rule (before any move) */
  originalStart: number;
}

const MAX_INSTANCES = 500;

function anchorOf(item: Item): number | null {
  return item.start ?? item.dueAt ?? null;
}

export function durationOf(item: Item): number {
  const anchor = anchorOf(item);
  if (anchor == null) return 0;
  if (item.allDay) return 24 * 60 * 60 * 1000;
  const end = item.end ?? anchor;
  return Math.max(0, end - anchor);
}

export function buildRule(item: Item): RRule | null {
  const anchor = anchorOf(item);
  if (!item.recurrence || anchor == null) return null;
  try {
    return new RRule({
      ...RRule.parseString(item.recurrence.rrule),
      dtstart: toFloating(anchor),
    });
  } catch {
    return null;
  }
}

/** All instances of a recurring item overlapping [from, to]. */
export function expandRecurrence(item: Item, from: number, to: number): ExpandedInstance[] {
  const rule = buildRule(item);
  const anchor = anchorOf(item);
  if (!rule || anchor == null) return [];

  const duration = durationOf(item);
  const windowStart = from - duration;
  let dates: Date[];
  try {
    dates = rule.between(toFloating(windowStart), toFloating(to), true);
  } catch {
    return [];
  }

  const out: ExpandedInstance[] = [];
  for (const d of dates) {
    if (out.length >= MAX_INSTANCES) break;
    const start = fromFloating(d);
    out.push({ start, end: start + duration, originalStart: start });
  }
  return out;
}

/** The first instance strictly after `after`, used to roll recurring tasks forward. */
export function nextOccurrence(item: Item, after: number): number | null {
  const rule = buildRule(item);
  if (!rule) return null;
  try {
    const next = rule.after(toFloating(after), false);
    return next ? fromFloating(next) : null;
  } catch {
    return null;
  }
}

/**
 * UNTIL stamp that ends a series just before `instant`, written in the same
 * floating local space the expansion works in. Used when splitting a series so
 * the two halves never both claim the split occurrence.
 */
export function untilBefore(instant: number): string {
  const d = new Date(instant - 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}00Z`
  );
}

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

function weekdayIndex(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const idx = WEEKDAY_CODES.indexOf(value as (typeof WEEKDAY_CODES)[number]);
    return idx >= 0 ? idx : 0;
  }
  const maybe = value as { weekday?: number };
  return typeof maybe?.weekday === "number" ? maybe.weekday : 0;
}

export interface RecurrenceForm {
  freq: Freq;
  interval: number;
  byDay: string[];
  end: { type: "never" } | { type: "on"; date: number } | { type: "after"; count: number };
}

export const WEEKDAYS = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
] as const;

export function buildRRuleString(form: RecurrenceForm): string {
  const parts = [`FREQ=${form.freq}`];
  if (form.interval > 1) parts.push(`INTERVAL=${form.interval}`);
  if (form.freq === "WEEKLY" && form.byDay.length > 0) {
    parts.push(`BYDAY=${form.byDay.join(",")}`);
  }
  if (form.end.type === "after") {
    parts.push(`COUNT=${Math.max(1, form.end.count)}`);
  } else if (form.end.type === "on") {
    // Same floating-local convention as dtstart: the last day the user picked,
    // at the end of that local day, must be the last instance included.
    const d = new Date(form.end.date);
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp =
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` + `T235959Z`;
    parts.push(`UNTIL=${stamp}`);
  }
  return parts.join(";");
}

export function describeRecurrence(rrule?: string | null): string {
  if (!rrule) return "Does not repeat";
  const opts = RRule.parseString(rrule);
  const interval = opts.interval ?? 1;
  const freq = opts.freq;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const rawDays = opts.byweekday == null ? [] : Array.isArray(opts.byweekday) ? opts.byweekday : [opts.byweekday];
  const byDay = rawDays
    .map((d) => dayNames[(weekdayIndex(d) + 1) % 7])
    .filter(Boolean);

  let base: string;
  if (freq === RRule.DAILY) base = interval === 1 ? "Every day" : `Every ${interval} days`;
  else if (freq === RRule.WEEKLY) {
    if (byDay.length === 7) base = interval === 1 ? "Every day" : `Every ${interval} weeks`;
    else if (byDay.length > 0) base = `${interval === 1 ? "Every" : `Every ${interval}`} ${byDay.join(", ")}`;
    else base = interval === 1 ? "Every week" : `Every ${interval} weeks`;
  } else if (freq === RRule.MONTHLY) base = interval === 1 ? "Every month" : `Every ${interval} months`;
  else if (freq === RRule.YEARLY) base = interval === 1 ? "Every year" : `Every ${interval} years`;
  else base = "Repeats";

  if (opts.count) base += `, ${opts.count} times`;
  else if (opts.until) {
    base += `, until ${new Date(opts.until).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  }
  return base;
}

/** A weekday code in the words the rest of the app uses: "SU" reads as "Sun". */
export function weekdayLabel(code: string): string {
  return WEEKDAYS.find((day) => day.code === code)?.label ?? code;
}

/** Monday-first position, so a day list reads in week order however it was picked. */
function weekdayOrder(code: string): number {
  const index = WEEKDAYS.findIndex((day) => day.code === code);
  return index < 0 ? WEEKDAYS.length : index;
}

/**
 * The one-line chip in the editor. It reads in words — "Weekly on Sun" — never
 * the bare rule codes, which look like noise outside the day picker.
 */
export function describeRecurrenceShort(rrule?: string | null): string {
  if (!rrule) return "Does not repeat";
  const form = recurrenceFormOf(rrule);
  const base =
    form.freq === "DAILY"
      ? "Daily"
      : form.freq === "WEEKLY"
        ? form.byDay.length
          ? `Weekly on ${
              [...form.byDay]
                .sort((a, b) => weekdayOrder(a) - weekdayOrder(b))
                .map(weekdayLabel)
                .join(", ")
            }`
          : "Weekly"
        : form.freq === "MONTHLY"
          ? "Monthly"
          : "Yearly";
  if (form.end.type === "after") return `${base} · ${form.end.count} times`;
  if (form.end.type === "on") {
    const until = new Date(form.end.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${base} · until ${until}`;
  }
  return base;
}

export function recurrenceFormOf(rrule?: string | null): RecurrenceForm {
  if (!rrule) {
    return { freq: "WEEKLY", interval: 1, byDay: [], end: { type: "never" } };
  }
  const opts = RRule.parseString(rrule);
  const rawDays = opts.byweekday == null ? [] : Array.isArray(opts.byweekday) ? opts.byweekday : [opts.byweekday];
  const byDay = rawDays.map((d) => WEEKDAY_CODES[weekdayIndex(d)]).filter(Boolean) as string[];

  const freqMap: Record<number, Freq> = {
    [RRule.DAILY]: "DAILY",
    [RRule.WEEKLY]: "WEEKLY",
    [RRule.MONTHLY]: "MONTHLY",
    [RRule.YEARLY]: "YEARLY",
  };

  let end: RecurrenceForm["end"] = { type: "never" };
  if (opts.count) end = { type: "after", count: opts.count };
  else if (opts.until) end = { type: "on", date: opts.until.getTime() };

  return {
    freq: freqMap[opts.freq ?? RRule.WEEKLY] ?? "WEEKLY",
    interval: opts.interval ?? 1,
    byDay,
    end,
  };
}
