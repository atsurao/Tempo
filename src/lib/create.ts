import type { Item, Project } from "../types";
import { PALETTE } from "../types";
import { createItem, createProject, ensureTag, type NewItem } from "../db/db";
import { parseQuickAdd } from "./nlp";
import { uid } from "./id";
import { blocksPatch } from "./timeblocks";
import type { EditorDraft } from "../store/ui";

export async function createFromText(
  text: string,
  projects: Project[],
  now = Date.now(),
  defaults: Partial<Item> = {},
): Promise<Item | null> {
  const parsed = parseQuickAdd(text, now);
  if (!parsed.title.trim()) return null;

  const tagIds: string[] = [];
  for (const name of parsed.tagNames) {
    const tag = await ensureTag(name);
    tagIds.push(tag.id);
  }

  let projectId: string | null = null;
  if (parsed.projectName) {
    const existing = projects.find(
      (p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase(),
    );
    if (existing) projectId = existing.id;
    else {
      const created = await createProject(
        parsed.projectName,
        PALETTE[projects.length % PALETTE.length],
        projects.length,
      );
      projectId = created.id;
    }
  }

  const item = await createItem({
    type: parsed.type,
    title: parsed.title,
    start: parsed.start,
    end: parsed.end,
    dueAt: parsed.dueAt,
    priority: parsed.priority,
    estimateMin: parsed.estimateMin,
    tagIds,
    projectId: projectId ?? defaults.projectId ?? null,
    workProjectId: defaults.workProjectId ?? null,
    scheduleMode: defaults.workProjectId ? (defaults.scheduleMode ?? "auto") : defaults.scheduleMode,
    durationDays: defaults.workProjectId ? (defaults.durationDays ?? 1) : defaults.durationDays,
    milestone: defaults.milestone,
    assigneeIds: defaults.assigneeIds ?? [],
    parentId: defaults.parentId ?? null,
    status: parsed.type === "task" ? (defaults.status ?? "todo") : undefined,
    reminders: parsed.type === "event" ? [{ id: uid("r"), offsetMin: 15 }] : [],
  });
  return item;
}

/** Turn an editor draft into a new item, keeping empty strings out of the DB. */
export async function createFromDraft(draft: EditorDraft): Promise<Item> {
  const payload: NewItem = {
    type: draft.type,
    title: draft.title?.trim() || (draft.type === "note" ? "Untitled note" : "Untitled"),
  };
  // A task with blocks takes its calendar placement from the first of them;
  // with none it simply has no time on the calendar.
  const placement: Partial<Item> =
    draft.type === "task" && draft.timeblocks?.length
      ? blocksPatch(draft.timeblocks)
      : { start: draft.start ?? undefined, end: draft.end ?? undefined };
  const item: Partial<Item> = {
    body: draft.body || undefined,
    ...placement,
    allDay: draft.allDay || undefined,
    dueAt: draft.dueAt ?? undefined,
    dueAllDay: draft.dueAllDay || undefined,
    projectId: draft.projectId ?? null,
    workProjectId: draft.workProjectId ?? null,
    scheduleMode: draft.workProjectId ? "auto" : undefined,
    durationDays: draft.workProjectId ? 1 : undefined,
    tagIds: draft.tagIds ?? [],
    priority: draft.priority ?? 0,
    status: draft.type === "task" ? (draft.status ?? "todo") : undefined,
    estimateMin: draft.estimateMin ?? undefined,
    parentId: draft.parentId ?? null,
    reminders: draft.reminders ?? [],
    recurrence: draft.recurrence ?? null,
    location: draft.location || undefined,
    url: draft.url || undefined,
  };
  return createItem(payload, item);
}
