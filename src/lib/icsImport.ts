import { RRule } from "rrule";
import type { Item, Priority, Project, Tag } from "../types";
import { db, syncedTransaction, type SyncTx } from "../db/db";
import { uid } from "./id";
import { normalizeTimes, parseIcs, type IcsEntry } from "./ics";

/** Upper bound on synthetic "this instance was deleted" rows per series. */
const MAX_EXCEPTIONS = 200;
/** Categories become tags; more than a handful per item is noise. */
const MAX_TAGS = 3;

export interface ImportCounts {
  events: number;
  tasks: number;
  recurring: number;
  duplicates: number;
  skipped: number;
}

export interface PreparedItem {
  item: Item;
  categories: string[];
}

export interface ImportPlan {
  calendarName: string | null;
  rows: PreparedItem[];
  counts: ImportCounts;
  /** first and last instant the file covers, for the confirmation summary */
  earliest: number | null;
  latest: number | null;
}

export interface ImportResult extends ImportCounts {
  calendarName: string | null;
  /** The calendar the rows landed in, when the import created or reused one. */
  calendarId?: string | null;
  ids: string[];
  tagNames: string[];
}

/** A name and colour for the calendar an import becomes. */
export interface CalendarChoice {
  name: string;
  color: string;
}

function icsPriority(value: number): Priority {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value <= 4) return 3; // RFC 5545: 1–4 high
  if (value === 5) return 2;
  return 1;
}

/** Drop a rule rrule.js cannot expand; the event still imports as a one-off. */
function usableRule(rrule: string | null): string | null {
  if (!rrule) return null;
  try {
    RRule.parseString(rrule);
    return rrule;
  } catch {
    return null;
  }
}

function toItem(entry: IcsEntry, sourceUid: string, now: number, order: number): Item {
  const { start, end } = normalizeTimes(entry);
  const isTask = entry.type === "task";
  const hasBlock = entry.start != null;
  const done = isTask && (entry.completed || entry.cancelled);
  return {
    id: uid(),
    type: entry.type,
    title: entry.title || (isTask ? "Untitled task" : "Untitled event"),
    body: entry.description || undefined,
    location: entry.location || undefined,
    url: entry.url || undefined,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    color: null,
    projectId: null,
    tagIds: [],
    start: hasBlock ? start : null,
    end: hasBlock ? end : null,
    allDay: entry.allDay || undefined,
    // A VTODO's DUE is its deadline; one that only has DTSTART uses that.
    dueAt: isTask ? (entry.dueAt ?? entry.start) : null,
    status: isTask ? (done ? "done" : "todo") : undefined,
    completedAt: done ? now : null,
    priority: isTask ? icsPriority(entry.priority) : undefined,
    parentId: null,
    order,
    recurrence: usableRule(entry.rrule) ? { rrule: entry.rrule as string } : null,
    reminders: entry.reminders.map((offsetMin) => ({ id: uid("r"), offsetMin })),
    sourceUid,
  };
}

/** The invisible row that removes one occurrence (EXDATE or a cancelled instance). */
function hiddenInstance(master: Item, originalStart: number, now: number, order: number): Item {
  const duration = master.start != null ? Math.max(0, (master.end ?? master.start) - master.start) : 0;
  return {
    id: uid(),
    type: master.type,
    title: master.title,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    start: originalStart,
    end: originalStart + duration,
    allDay: master.allDay,
    dueAt: null,
    status: master.type === "task" ? "todo" : undefined,
    tagIds: [],
    reminders: [],
    recurrence: null,
    recurrenceParentId: master.id,
    originalStart,
    cancelled: true,
    order,
    sourceUid: master.sourceUid ?? null,
  };
}

function dedupeIndex(existing: Item[]): {
  masters: Map<string, Item>;
  exceptionKeys: Set<string>;
} {
  const masters = new Map<string, Item>();
  const exceptionKeys = new Set<string>();
  for (const item of existing) {
    if (item.deletedAt || !item.sourceUid) continue;
    if (item.recurrenceParentId) {
      if (item.originalStart != null) {
        exceptionKeys.add(`${item.sourceUid}|${item.originalStart}`);
      }
    } else if (!masters.has(item.sourceUid)) {
      masters.set(item.sourceUid, item);
    }
  }
  return { masters, exceptionKeys };
}

/** Parse a file and work out exactly what would be written. No writes. */
export function planImport(text: string, existing: Item[]): ImportPlan {
  const parsed = parseIcs(text);
  const { masters: masterByUid, exceptionKeys } = dedupeIndex(existing);
  const now = Date.now();
  const rows: PreparedItem[] = [];
  const counts: ImportCounts = {
    events: 0,
    tasks: 0,
    recurring: 0,
    duplicates: 0,
    skipped: parsed.skipped,
  };
  let earliest: number | null = null;
  let latest: number | null = null;
  let order = 0;

  const note = (entry: IcsEntry, item: Item) => {
    if (item.type === "event") counts.events += 1;
    else counts.tasks += 1;
    if (item.recurrence) counts.recurring += 1;
    const start = item.start ?? item.dueAt;
    if (start != null) {
      if (earliest == null || start < earliest) earliest = start;
      const end = item.end ?? start;
      if (latest == null || end > latest) latest = end;
    }
    rows.push({ item, categories: entry.categories });
  };

  const masters = parsed.entries.filter((e) => e.recurrenceId == null);
  const overrides = parsed.entries.filter((e) => e.recurrenceId != null);

  for (const entry of masters) {
    // Exports without a UID still import; they just cannot be de-duplicated.
    const sourceUid = entry.uid || uid("ics");
    if (entry.uid && masterByUid.has(sourceUid)) {
      counts.duplicates += 1;
      continue;
    }
    const master = toItem(entry, sourceUid, now, order++);
    masterByUid.set(sourceUid, master);
    note(entry, master);

    for (const excluded of entry.exdates.slice(0, MAX_EXCEPTIONS)) {
      const key = `${sourceUid}|${excluded}`;
      if (exceptionKeys.has(key)) continue;
      exceptionKeys.add(key);
      rows.push({
        item: hiddenInstance(master, excluded, now, order++),
        categories: [],
      });
    }
  }

  for (const entry of overrides) {
    const originalStart = entry.recurrenceId as number;
    const key = entry.uid ? `${entry.uid}|${originalStart}` : "";
    if (key && exceptionKeys.has(key)) {
      counts.duplicates += 1;
      continue;
    }
    if (key) exceptionKeys.add(key);

    const master = entry.uid ? masterByUid.get(entry.uid) : undefined;
    if (!master) {
      // An override whose series is missing: a deleted one is noise, a moved
      // one is still a real appointment worth keeping on its new date.
      if (entry.cancelled) {
        counts.skipped += 1;
        continue;
      }
      const standalone = toItem(entry, entry.uid || uid("ics"), now, order++);
      standalone.recurrence = null;
      note(entry, standalone);
      continue;
    }

    const instance = toItem(entry, master.sourceUid ?? entry.uid, now, order++);
    instance.recurrence = null;
    instance.recurrenceParentId = master.id;
    instance.originalStart = originalStart;
    if (entry.cancelled) instance.cancelled = true;
    note(entry, instance);
  }

  return { calendarName: parsed.calendarName, rows, counts, earliest, latest };
}

/** Resolve the categories on each row into real tags, creating missing ones. */
async function assignTags(
  plan: ImportPlan,
  existingTags: Tag[],
  tx: SyncTx,
): Promise<string[]> {
  const tagByName = new Map(existingTags.map((tag) => [tag.name.toLowerCase(), tag]));
  const tagNames = new Set<string>();

  for (const row of plan.rows) {
    if (!row.categories.length) continue;
    const ids = new Set<string>();
    for (const name of row.categories.slice(0, MAX_TAGS)) {
      const key = name.toLowerCase();
      let tag = tagByName.get(key);
      if (!tag) {
        tag = { id: uid("t"), name };
        await tx.put("tags", tag);
        tagByName.set(key, tag);
      }
      ids.add(tag.id);
      tagNames.add(tag.name);
    }
    row.item.tagIds = [...ids];
  }

  return [...tagNames];
}

function nextProjectOrder(projects: Project[]): number {
  return projects.reduce((max, project) => Math.max(max, project.order ?? 0), 0) + 1;
}

/** Only a plain #rrggbb reaches storage, whatever the picker returned. */
function cleanColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : "#4f46e5";
}

/** Write a planned import: resolve tags, then insert every row in one go. */
export async function applyImport(plan: ImportPlan, existingTags: Tag[]): Promise<ImportResult> {
  let tagNames: string[] = [];
  await syncedTransaction([db.items, db.tags], async (tx) => {
    tagNames = await assignTags(plan, existingTags, tx);
    for (const row of plan.rows) await tx.put("items", row.item);
  }, { allowSplit: true });

  return {
    ...plan.counts,
    calendarName: plan.calendarName,
    ids: plan.rows.map((row) => row.item.id),
    tagNames,
  };
}

/**
 * Import straight into a named, coloured calendar. Setup uses this: every row
 * takes the calendar's id, and a calendar with the same name is reused, so
 * running setup twice does not stack two calendars with one name.
 */
export async function applyImportToCalendar(
  plan: ImportPlan,
  existingTags: Tag[],
  calendar: CalendarChoice,
  existingProjects: Project[] = [],
): Promise<ImportResult> {
  const name = (calendar.name.trim() || plan.calendarName || "Imported calendar").slice(0, 80);
  const color = cleanColor(calendar.color);
  const match = existingProjects.find(
    (project) => project.name.trim().toLowerCase() === name.toLowerCase(),
  );
  const projectId = match?.id ?? uid("p");

  for (const row of plan.rows) row.item.projectId = projectId;
  let tagNames: string[] = [];

  await syncedTransaction([db.items, db.projects, db.tags], async (tx) => {
    if (!match) {
      await tx.put("projects", {
        id: projectId,
        name,
        color,
        order: nextProjectOrder(existingProjects),
      });
    }
    tagNames = await assignTags(plan, existingTags, tx);
    for (const row of plan.rows) await tx.put("items", row.item);
  }, { allowSplit: true });

  return {
    ...plan.counts,
    calendarName: name,
    calendarId: projectId,
    ids: plan.rows.map((row) => row.item.id),
    tagNames,
  };
}

/** Soft-delete everything a single import created, for the undo button. */
export async function undoImport(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const now = Date.now();
  const unique = [...new Set(ids)];
  await syncedTransaction([db.items], async (tx) => {
    for (const id of unique) {
      await tx.patch<Item>("items", id, { deletedAt: now, updatedAt: now });
    }
  }, { allowSplit: true });
}
