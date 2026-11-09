import type { Item, Occurrence, Project } from "../types";
import type { EditorDraft } from "../store/ui";
import { blocksOf } from "./timeblocks";

/** Opening an occurrence of a series shows that instance's actual times. */
export function draftFromItem(item: Item, occ?: Occurrence): EditorDraft {
  return {
    type: item.type,
    title: item.title,
    body: item.body ?? "",
    start: occ ? occ.start : (item.start ?? null),
    end: occ ? occ.end : (item.end ?? null),
    allDay: item.allDay ?? false,
    dueAt: item.dueAt ?? null,
    dueAllDay: item.dueAllDay ?? false,
    // A task's blocks are its calendar placement; the task itself never
    // repeats, so the old single placement reads as one block with its rule.
    timeblocks: item.type === "task" ? blocksOf(item).map((block) => ({ ...block })) : [],
    projectId: item.projectId ?? null,
    workProjectId: item.workProjectId ?? null,
    tagIds: item.tagIds ?? [],
    priority: item.priority ?? 0,
    status: item.status,
    estimateMin: item.estimateMin ?? null,
    parentId: item.parentId ?? null,
    reminders: item.reminders ?? [],
    recurrence: item.recurrence ?? null,
    location: item.location ?? "",
    url: item.url ?? "",
  };
}

export function resolveColor(item: Item, projects: Project[]): string {
  if (item.color) return item.color;
  const project = projects.find((p) => p.id === item.projectId);
  return project?.color ?? "var(--accent)";
}

export const DND_TYPE = "application/x-tempo-item";
