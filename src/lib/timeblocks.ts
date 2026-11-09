import type { Item, TimeBlock } from "../types";
import { DAY } from "./date";
import { uid } from "./id";

/**
 * Tasks own a list of calendar blocks, not one start and end. Older rows still
 * hold a single placement in `start`/`end`, so reading a task always goes
 * through here: a task saved before blocks existed reads as one block, with the
 * task's own repeat rule attached to that block.
 */
export const LEGACY_BLOCK_ID = "legacy";

const HOUR = 60 * 60_000;
const DEFAULT_LENGTH = HOUR;

/** The blocks a task actually draws, including the legacy single placement. */
export function blocksOf(item: Pick<Item, "start" | "end" | "timeblocks" | "recurrence">): TimeBlock[] {
  if (item.timeblocks && item.timeblocks.length > 0) return sortBlocks(item.timeblocks);
  if (item.start == null) return [];
  return [
    {
      id: LEGACY_BLOCK_ID,
      start: item.start,
      end: item.end ?? item.start + DEFAULT_LENGTH,
      recurrence: item.recurrence ?? null,
    },
  ];
}

export function sortBlocks(blocks: TimeBlock[]): TimeBlock[] {
  return [...blocks].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** A block that ends before it starts would draw backwards; keep it sane. */
export function normalizeBlock(block: TimeBlock): TimeBlock {
  const start = block.start;
  const end = block.end > start ? block.end : start + DEFAULT_LENGTH;
  return { ...block, start, end };
}

/**
 * The item patch for a new block list. `start`/`end` mirror the first block so
 * the views that still read one placement (today, timeline, board) keep
 * working, and an empty list clears that placement.
 */
export function blocksPatch(blocks: TimeBlock[]): Partial<Item> {
  const sorted = sortBlocks(blocks).map(normalizeBlock);
  const first = sorted[0];
  return {
    timeblocks: sorted,
    start: first?.start ?? null,
    end: first?.end ?? null,
  };
}

export function newBlock(start: number, end?: number): TimeBlock {
  return {
    id: uid("tb"),
    start,
    end: end ?? start + DEFAULT_LENGTH,
    recurrence: null,
  };
}

/**
 * Where a fresh block should land: after the last one, on the next day at the
 * same clock time, or at 9:00 today when the task has no blocks yet.
 */
export function suggestBlock(blocks: TimeBlock[], now = Date.now()): { start: number; end: number } {
  if (blocks.length === 0) {
    const d = new Date(now);
    d.setHours(9, 0, 0, 0);
    return { start: d.getTime(), end: d.getTime() + HOUR };
  }
  const last = sortBlocks(blocks)[blocks.length - 1];
  const start = last.start + DAY;
  const length = Math.max(15 * 60_000, last.end - last.start);
  return { start, end: start + length };
}

/** The soonest block still ahead of `now`, for task rows and today views. */
export function nextBlock(blocks: TimeBlock[], now = Date.now()): TimeBlock | null {
  return sortBlocks(blocks).find((block) => block.end > now) ?? null;
}

/** True when any block repeats, for the little ↻ the lists show. */
export function repeatsBlocks(item: Parameters<typeof blocksOf>[0]): boolean {
  return blocksOf(item).some((block) => Boolean(block.recurrence));
}

/** A short human line: "9:00 – 10:00" is the caller's job; this counts them. */
export function blockCountLabel(blocks: TimeBlock[]): string {
  return blocks.length === 1 ? "1 block" : `${blocks.length} blocks`;
}
