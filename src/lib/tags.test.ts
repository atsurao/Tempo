import { describe, expect, it } from "vitest";
import type { Item, Tag } from "../types";
import { buildTagUsage, firstTagName, tagColor, tagMap } from "./tags";

const tags: Tag[] = [
  { id: "t_school", name: "school" },
  { id: "t_home", name: "Home" },
  { id: "t_empty", name: "archive" },
];

function item(id: string, type: Item["type"], tagIds: string[], extra: Partial<Item> = {}): Item {
  return {
    id,
    type,
    title: id,
    tagIds,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

describe("buildTagUsage", () => {
  it("collects tasks and events under each tag, sorted by name", () => {
    const usage = buildTagUsage(tags, [
      item("b", "task", ["t_school"]),
      item("a", "event", ["t_school", "t_home"]),
      item("c", "note", ["t_school"]),
    ]);
    expect(usage.map((entry) => entry.tag.name)).toEqual(["archive", "Home", "school"]);
    const school = usage.find((entry) => entry.tag.id === "t_school")!;
    expect(school.items.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(school.tasks.map((entry) => entry.id)).toEqual(["b"]);
    expect(school.events.map((entry) => entry.id)).toEqual(["a"]);
    expect(usage.find((entry) => entry.tag.id === "t_empty")?.items).toEqual([]);
  });

  it("ignores deleted items, cancelled occurrences and generated recurrence copies", () => {
    const usage = buildTagUsage(tags, [
      item("live", "task", ["t_home"]),
      item("deleted", "task", ["t_home"], { deletedAt: 2 }),
      item("cancelled", "event", ["t_home"], { cancelled: true }),
      item("copy", "event", ["t_home"], { recurrenceParentId: "master" }),
    ]);
    expect(usage.find((entry) => entry.tag.id === "t_home")?.items.map((entry) => entry.id)).toEqual([
      "live",
    ]);
  });

  it("draws a stable colour and finds the first tag for sorting", () => {
    expect(tagColor(tags[0])).toBe(tagColor({ ...tags[0] }));
    const first = firstTagName(
      item("task", "task", ["t_school", "t_home"]),
      tagMap(tags),
    );
    expect(first).toBe("Home");
    expect(firstTagName(item("untagged", "task", []), tagMap(tags))).toBe("\uffff");
  });
});
