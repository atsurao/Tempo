import { describe, expect, it } from "vitest";
import type { Item, TimeBlock } from "../types";
import { DAY, sod } from "./date";
import {
  LEGACY_BLOCK_ID,
  blocksOf,
  blocksPatch,
  newBlock,
  nextBlock,
  repeatsBlocks,
  suggestBlock,
} from "./timeblocks";

const task = (patch: Partial<Item> = {}): Item => ({
  id: "t_1",
  type: "task",
  title: "Reading",
  createdAt: 0,
  updatedAt: 0,
  status: "todo",
  ...patch,
});

const day = (d: number, h = 9): number => sod(new Date(2026, 9, d).getTime()) + h * 3_600_000;

const block = (id: string, start: number, end: number): TimeBlock => ({ id, start, end });

describe("blocksOf", () => {
  it("reads an older single placement as one block with its rule", () => {
    const blocks = blocksOf(
      task({ start: day(19), end: day(19, 10), recurrence: { rrule: "FREQ=WEEKLY" } }),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe(LEGACY_BLOCK_ID);
    expect(blocks[0].recurrence?.rrule).toBe("FREQ=WEEKLY");
  });

  it("returns no blocks for a task with no calendar placement", () => {
    expect(blocksOf(task({ dueAt: day(21) }))).toEqual([]);
  });

  it("sorts a saved list and keeps it verbatim", () => {
    const blocks = blocksOf(
      task({
        timeblocks: [block("b", day(21), day(21, 10)), block("a", day(19), day(19, 10))],
      }),
    );
    expect(blocks.map((b) => b.id)).toEqual(["a", "b"]);
  });
});

describe("blocksPatch", () => {
  it("mirrors the earliest block into start and end", () => {
    const patch = blocksPatch([
      block("late", day(22), day(22, 11)),
      block("early", day(19), day(19, 10)),
    ]);
    expect(patch.start).toBe(day(19));
    expect(patch.end).toBe(day(19, 10));
    expect(patch.timeblocks?.map((b) => b.id)).toEqual(["early", "late"]);
  });

  it("clears the calendar placement when every block is removed", () => {
    expect(blocksPatch([])).toEqual({ timeblocks: [], start: null, end: null });
  });

  it("gives a block a sane end when it was saved backwards", () => {
    const patch = blocksPatch([block("x", day(19, 10), day(19, 9))]);
    expect(patch.timeblocks![0].end).toBe(day(19, 10) + 3_600_000);
  });
});

describe("suggestions", () => {
  it("puts the first block at 9:00 today", () => {
    const now = day(19, 14);
    const span = suggestBlock([], now);
    expect(span.start).toBe(day(19, 9));
    expect(span.end).toBe(day(19, 10));
  });

  it("puts the next block on the day after the last, same length", () => {
    const span = suggestBlock([block("a", day(19, 9), day(19, 11))], day(20));
    expect(span.start).toBe(day(20, 9));
    expect(span.end).toBe(day(20, 11));
  });

  it("finds the next block still ahead", () => {
    const blocks = [block("a", day(19), day(19, 10)), block("b", day(21), day(21, 10))];
    expect(nextBlock(blocks, day(20))?.id).toBe("b");
    expect(nextBlock(blocks, day(22))).toBeNull();
  });
});

describe("newBlock and repeatsBlocks", () => {
  it("creates an hour-long block by default", () => {
    const created = newBlock(day(19));
    expect(created.end - created.start).toBe(3_600_000);
    expect(created.recurrence).toBeNull();
  });

  it("reports a repeat on any block", () => {
    const recurring = blocksOf(
      task({
        timeblocks: [
          block("a", day(19), day(19, 10)),
          { ...block("b", day(21), day(21, 10)), recurrence: { rrule: "FREQ=WEEKLY" } },
        ],
      }),
    );
    expect(repeatsBlocks(task({ timeblocks: recurring }))).toBe(true);
    expect(repeatsBlocks(task({ timeblocks: [block("a", day(19), day(19, 10))] }))).toBe(false);
  });

  it("treats a legacy recurring placement as repeating", () => {
    expect(repeatsBlocks(task({ start: day(19), recurrence: { rrule: "FREQ=DAILY" } }))).toBe(true);
    expect(repeatsBlocks(task({ start: day(19) }))).toBe(false);
  });

  it("anchors the suggestion after a block that crossed a day boundary", () => {
    const span = suggestBlock([block("a", day(19, 23), day(19, 23) + 2 * 3_600_000)]);
    expect(span.start - day(19, 23)).toBe(DAY);
  });
});
