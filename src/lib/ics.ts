/**
 * A small, dependency-free reader for the parts of RFC 5545 that calendar
 * exports actually use: VEVENT / VTODO, DTSTART / DTEND / DUE / DURATION,
 * TZID wall-clock times, RRULE, EXDATE, RECURRENCE-ID overrides, VALARM
 * triggers and text escaping. Unknown properties are ignored on purpose.
 */

export interface IcsEntry {
  uid: string;
  type: "event" | "task";
  title: string;
  description: string;
  location: string;
  url: string;
  /** absolute ms, already resolved to the machine's timeline */
  start: number | null;
  end: number | null;
  dueAt: number | null;
  /** DUE was a bare date, with no time of day */
  dueDateOnly: boolean;
  allDay: boolean;
  rrule: string | null;
  /** excluded occurrence starts (EXDATE) */
  exdates: number[];
  /** set on an overridden instance: the start it replaces */
  recurrenceId: number | null;
  cancelled: boolean;
  completed: boolean;
  /** reminder offsets in minutes before the start */
  reminders: number[];
  durationMs: number | null;
  /** raw ICS PRIORITY (1 highest … 9 lowest, 0 unset) */
  priority: number;
  categories: string[];
}

export interface IcsParseResult {
  entries: IcsEntry[];
  /** calendars that declared their own name (X-WR-CALNAME) */
  calendarName: string | null;
  total: number;
  skipped: number;
}

function blankEntry(type: IcsEntry["type"]): IcsEntry {
  return {
    uid: "",
    type,
    title: "",
    description: "",
    location: "",
    url: "",
    start: null,
    end: null,
    dueAt: null,
    dueDateOnly: false,
    allDay: false,
    rrule: null,
    exdates: [],
    recurrenceId: null,
    cancelled: false,
    completed: false,
    reminders: [],
    durationMs: null,
    priority: 0,
    categories: [],
  };
}

/** RFC 5545 line folding: continuations start with a space or tab. */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Split `NAME;PARAM="a:b":value` without tripping over a colon in a parameter. */
function splitProperty(line: string): Property | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      params[part.slice(0, eq).toUpperCase()] = part
        .slice(eq + 1)
        .replace(/^"|"$/g, "");
    }
  }
  return { name: name.trim().toUpperCase(), params, value };
}

function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = zoneFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    formatter = null;
  }
  zoneFormatters.set(timeZone, formatter);
  return formatter;
}

/** Offset of `timeZone` from UTC at a given instant, in ms. */
function zoneOffset(timeZone: string, instant: number): number | null {
  const formatter = formatterFor(timeZone);
  if (!formatter) return null;
  const parts = formatter.formatToParts(new Date(instant));
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const hour = read("hour") % 24;
  const minute = read("minute");
  const second = read("second");
  if ([year, month, day, hour, minute, second].some((n) => Number.isNaN(n))) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second) - instant;
}

/** Wall-clock time in a named zone → absolute ms. Null when the zone is unknown. */
function zonedTime(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number | null {
  const wallUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = zoneOffset(timeZone, wallUtc);
  if (first == null) return null;
  let instant = wallUtc - first;
  // Re-read the offset at the resolved instant so DST edges land correctly.
  const second = zoneOffset(timeZone, instant);
  if (second != null) instant = wallUtc - second;
  return instant;
}

function parseDateValue(
  rawValue: string,
  params: Record<string, string>,
): { ts: number; dateOnly: boolean } | null {
  const value = rawValue.trim();
  const dateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(value);
  if (dateOnly) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!m) return null;
    const ts = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    return Number.isNaN(ts) ? null : { ts, dateOnly: true };
  }

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zulu] = m;
  const parts = [Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s)] as const;
  if (parts.some((n) => Number.isNaN(n))) return null;

  // `mo` is 1-based from the serialized value; Date.UTC wants a month index.
  if (zulu) {
    return { ts: Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]), dateOnly: false };
  }

  const timeZone = params.TZID;
  if (timeZone) {
    const zoned = zonedTime(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], timeZone);
    if (zoned != null) return { ts: zoned, dateOnly: false };
  }
  // Floating time (or a TZID Intl cannot resolve): treat it as local, which is
  // what "wall clock in my calendar" means to the person importing.
  return {
    ts: new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime(),
    dateOnly: false,
  };
}

function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim().toUpperCase(),
  );
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const weeks = Number(m[2] ?? 0);
  const days = Number(m[3] ?? 0);
  const hours = Number(m[4] ?? 0);
  const minutes = Number(m[5] ?? 0);
  const seconds = Number(m[6] ?? 0);
  const ms = ((weeks * 7 + days) * 86_400 + hours * 3_600 + minutes * 60 + seconds) * 1_000;
  return sign * ms;
}

/** Relative VALARM trigger → minutes before the start. Absolute triggers are skipped. */
function parseTrigger(value: string, params: Record<string, string>): number | null {
  if (params.VALUE === "DATE-TIME") return null;
  const ms = parseDuration(value);
  if (ms == null) return null;
  const minutes = Math.round(-ms / 60_000);
  return minutes >= 0 ? minutes : null;
}

export function parseIcs(text: string): IcsParseResult {
  const lines = unfold(text);
  const entries: IcsEntry[] = [];
  let calendarName: string | null = null;
  let current: IcsEntry | null = null;
  let inAlarm = false;
  let total = 0;
  let skipped = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const prop = splitProperty(line);
    if (!prop) continue;
    const { name, params, value } = prop;

    if (name === "BEGIN") {
      const component = value.trim().toUpperCase();
      if (component === "VEVENT" || component === "VTODO") {
        current = blankEntry(component === "VTODO" ? "task" : "event");
        inAlarm = false;
      } else if (component === "VALARM") {
        inAlarm = true;
      }
      continue;
    }

    if (name === "END") {
      const component = value.trim().toUpperCase();
      if (component === "VEVENT" || component === "VTODO") {
        if (current) {
          total++;
          // A todo that only carries a date (no time) is an all-day deadline.
          if (current.type === "task" && current.start == null && current.dueDateOnly) {
            current.allDay = true;
          }
          // A cancelled series is noise; a cancelled instance must still be
          // kept so the occurrence disappears from the imported series.
          const keep = current.start != null || current.dueAt != null;
          if (keep && !(current.cancelled && current.recurrenceId == null)) {
            entries.push(current);
          } else {
            skipped++;
          }
        }
        current = null;
        inAlarm = false;
      } else if (component === "VALARM") {
        inAlarm = false;
      }
      continue;
    }

    if (!current) {
      if (name === "X-WR-CALNAME") calendarName = unescapeText(value).trim() || null;
      continue;
    }

    if (inAlarm) {
      if (name === "TRIGGER") {
        const minutes = parseTrigger(value, params);
        if (minutes != null && !current.reminders.includes(minutes)) {
          current.reminders.push(minutes);
        }
      }
      continue;
    }

    switch (name) {
      case "UID":
        current.uid = value.trim();
        break;
      case "SUMMARY":
        current.title = unescapeText(value).trim();
        break;
      case "DESCRIPTION":
        current.description = unescapeText(value).trim();
        break;
      case "LOCATION":
        current.location = unescapeText(value).trim();
        break;
      case "URL":
        current.url = value.trim();
        break;
      case "DTSTART": {
        const parsed = parseDateValue(value, params);
        if (parsed) {
          current.start = parsed.ts;
          current.allDay = parsed.dateOnly;
        }
        break;
      }
      case "DTEND": {
        const parsed = parseDateValue(value, params);
        if (parsed) current.end = parsed.ts;
        break;
      }
      case "DUE": {
        const parsed = parseDateValue(value, params);
        if (parsed) {
          current.dueAt = parsed.ts;
          current.dueDateOnly = parsed.dateOnly;
        }
        break;
      }
      case "DURATION": {
        const ms = parseDuration(value);
        if (ms != null) current.durationMs = ms;
        break;
      }
      case "RRULE":
        current.rrule = value.trim().replace(/^RRULE:/i, "").toUpperCase();
        break;
      case "EXDATE":
        for (const part of value.split(",")) {
          const parsed = parseDateValue(part, params);
          if (parsed) current.exdates.push(parsed.ts);
        }
        break;
      case "RECURRENCE-ID": {
        const parsed = parseDateValue(value, params);
        if (parsed) current.recurrenceId = parsed.ts;
        break;
      }
      case "STATUS": {
        const status = value.trim().toUpperCase();
        current.cancelled = status === "CANCELLED";
        if (status === "COMPLETED") current.completed = true;
        break;
      }
      case "PRIORITY":
        current.priority = Number(value.trim());
        break;
      case "CATEGORIES":
        for (const part of value.split(",")) {
          const name = unescapeText(part).trim();
          if (name) current.categories.push(name);
        }
        break;
      case "COMPLETED":
        current.completed = value.trim().length > 0;
        break;
      default:
        break;
    }
  }

  return { entries, calendarName, total, skipped };
}

/**
 * Turn a parsed entry into the shape this app stores: all-day ends become
 * inclusive (the item editor keeps `end` on the last day, not midnight after).
 */
export function normalizeTimes(entry: IcsEntry): { start: number | null; end: number | null } {
  let start = entry.start;
  let end = entry.end;
  if (start == null) return { start: null, end: null };
  if (end == null && entry.durationMs != null) end = start + entry.durationMs;
  if (end != null && entry.allDay) end = Math.max(start, end - 1);
  if (end == null) end = entry.allDay ? start + 86_400_000 - 1 : start;
  return { start, end };
}
