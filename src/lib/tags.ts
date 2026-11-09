import { PALETTE, type Item, type Tag } from "../types";

/** A tag together with the live tasks and events that currently belong to it. */
export interface TagUsage {
  tag: Tag;
  items: Item[];
  tasks: Item[];
  events: Item[];
}

/**
 * Tags are a collection, not just a label on one row. Membership is derived
 * from the item's `tagIds`, so creating a tag once and applying it to any task
 * or event immediately puts that item under the tag everywhere in the app.
 */
export function buildTagUsage(tags: Tag[], items: Item[]): TagUsage[] {
  const byTag = new Map<string, Item[]>();
  for (const item of items) {
    if (item.deletedAt || item.cancelled) continue;
    if (item.type !== "task" && item.type !== "event") continue;
    // A recurring series is one member; its generated exceptions are not extra
    // copies of the same work in the tag's collection.
    if (item.recurrenceParentId) continue;
    for (const id of new Set(item.tagIds ?? [])) {
      const current = byTag.get(id);
      if (current) current.push(item);
      else byTag.set(id, [item]);
    }
  }

  return [...tags]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map((tag) => {
      const members = (byTag.get(tag.id) ?? []).sort(
        (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
      return {
        tag,
        items: members,
        tasks: members.filter((item) => item.type === "task"),
        events: members.filter((item) => item.type === "event"),
      };
    });
}

/** A readable colour for a tag, whether or not it has an explicit one. */
export function tagColor(tag: Tag): string {
  if (tag.color) return tag.color;
  let hash = 0;
  for (let i = 0; i < tag.name.length; i += 1) {
    hash = (hash * 31 + tag.name.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Case-insensitive name lookup used for sorting and labels. */
export function tagMap(tags: Tag[]): Map<string, Tag> {
  return new Map(tags.map((tag) => [tag.id, tag]));
}

/** Sort key for "Tag": the first named tag, with untagged work last. */
export function firstTagName(item: Item, tags: Map<string, Tag>): string {
  const names = (item.tagIds ?? [])
    .map((id) => tags.get(id)?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return names[0] ?? "\uffff";
}
