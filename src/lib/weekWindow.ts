import { addDays, startOfWeek } from "date-fns";
import { DAY } from "./date";

/** Weeks loaded around the anchor's week, so a week is never at a bare edge. */
export const WEEK_PAD = 2;
/** Weeks added to the strip whenever the reader nears an end. */
export const WEEK_ADD = 2;
/** The starting size of the strip: the anchor's week plus two either side. */
export const WEEK_COUNT = 7 * (WEEK_PAD * 2 + 1);
/**
 * The most days the strip may hold.
 *
 * The week view is endless, but the strip that carries it must not be: every
 * extra day is another column of events inside one very wide scrolling
 * element, and WebKit starts dropping tiles — grey boxes, then a blank
 * window — once that layer gets large. Two weeks of runway either side of the
 * reader is plenty, and it keeps the painted strip a few screens wide at every
 * zoom level. Past this size the far edge is dropped as the near edge grows,
 * so the strip keeps its size instead of widening for the rest of the session.
 */
export const WEEK_MAX = WEEK_COUNT + 7 * WEEK_ADD;

export interface WeekWindow {
  from: number;
  count: number;
}

/** The strip a fresh jump needs: the anchor's week, two weeks either side. */
export function weekWindowFor(anchor: number, weekStart: 0 | 1): WeekWindow {
  const start = startOfWeek(anchor, { weekStartsOn: weekStart });
  return { from: addDays(start, -7 * WEEK_PAD).getTime(), count: WEEK_COUNT };
}

/**
 * Grow the strip by two weeks in the direction of travel. Once it is at its
 * limit, days leave from the opposite edge — but never the reader's own day —
 * so the strip keeps a constant size and a constant amount of runway.
 *
 * Both ends are adjusted by the same amount whenever days are dropped, which
 * keeps the strip's width constant: a shrinking scroll surface makes WebKit
 * clamp the offset mid-pan, and that clamp is what the reader sees as the week
 * jumping under their hands.
 *
 * The caller compensates the scroll position for days that leave the start;
 * days leaving the end need no compensation.
 */
export function slideWeekWindow(w: WeekWindow, dir: -1 | 1, anchor: number): WeekWindow {
  const added = 7 * WEEK_ADD;
  const from = dir < 0 ? w.from - added * DAY : w.from;
  const count = w.count + added;
  if (count <= WEEK_MAX) return { from, count };

  const excess = count - WEEK_MAX;
  const end = from + count * DAY;
  // Days that may leave each edge: never the reader's own day.
  const behind = Math.max(0, Math.floor((anchor - from) / DAY));
  const ahead = Math.max(0, Math.floor((end - (anchor + DAY)) / DAY));

  // Prefer the edge the reader is leaving. If that edge cannot give up enough
  // days, the other one makes up the rest: dropping the far side keeps the
  // strip bounded, and the reader is not heading there.
  const near = Math.min(excess, dir > 0 ? behind : ahead);
  const far = Math.min(excess - near, dir > 0 ? ahead : behind);
  const dropStart = dir > 0 ? near : far;
  const dropEnd = dir > 0 ? far : near;
  return { from: from + dropStart * DAY, count: count - dropStart - dropEnd };
}

/** Whether the anchor's day still falls inside the loaded strip. */
export function windowCovers(w: WeekWindow, anchor: number): boolean {
  return anchor >= w.from && anchor < w.from + w.count * DAY;
}
