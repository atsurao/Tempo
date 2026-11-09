import { describe, expect, it } from "vitest";
import { DAY } from "./date";
import {
  WEEK_COUNT,
  WEEK_MAX,
  slideWeekWindow,
  weekWindowFor,
  windowCovers,
} from "./weekWindow";

const anchor = new Date(2026, 9, 18).getTime();

describe("weekWindowFor", () => {
  it("loads two weeks either side of the anchor's week", () => {
    const w = weekWindowFor(anchor, 0);
    expect(w.count).toBe(WEEK_COUNT);
    // Sunday anchor, Sunday week start: the strip opens two weeks back.
    expect(Math.round((anchor - w.from) / DAY)).toBe(14);
    expect(windowCovers(w, anchor)).toBe(true);
  });
});

describe("slideWeekWindow", () => {
  it("grows forward without moving the start while there is room", () => {
    const w = weekWindowFor(anchor, 0);
    const next = slideWeekWindow(w, 1, anchor);
    expect(next.from).toBe(w.from);
    expect(next.count).toBe(w.count + 14);
    expect(windowCovers(next, anchor)).toBe(true);
  });

  it("grows backward by moving the start earlier", () => {
    const w = weekWindowFor(anchor, 0);
    const next = slideWeekWindow(w, -1, anchor);
    expect(Math.round((w.from - next.from) / DAY)).toBe(14);
    expect(next.count).toBe(w.count + 14);
  });

  it("drops days behind the reader at the ceiling, keeping its width", () => {
    // Reader four weeks into a full strip, heading forward.
    const full = { from: anchor - 28 * DAY, count: WEEK_MAX };
    const next = slideWeekWindow(full, 1, anchor);
    expect(next.count).toBe(WEEK_MAX);
    expect(Math.round((next.from - full.from) / DAY)).toBe(14);
    expect(windowCovers(next, anchor)).toBe(true);
  });

  it("drops days ahead of the reader when heading back, keeping its width", () => {
    const full = { from: anchor - 28 * DAY, count: WEEK_MAX };
    const next = slideWeekWindow(full, -1, anchor);
    expect(next.count).toBe(WEEK_MAX);
    expect(next.from).toBe(full.from - 14 * DAY);
    expect(windowCovers(next, anchor)).toBe(true);
  });

  it("never widens past its ceiling, even with the reader at an edge", () => {
    // The reader sits on the strip's first day but the strip still grows.
    const full = { from: anchor, count: WEEK_MAX };
    const next = slideWeekWindow(full, 1, anchor);
    expect(next.count).toBeLessThanOrEqual(WEEK_MAX);
    expect(windowCovers(next, anchor)).toBe(true);
  });

  it("keeps the reader's day and a bounded strip for a long pan", () => {
    let w = weekWindowFor(anchor, 0);
    let visible = anchor;
    for (let i = 0; i < 80; i++) {
      const dir = i % 7 === 6 ? -1 : 1;
      w = slideWeekWindow(w, dir, visible);
      visible += dir * 14 * DAY;
      expect(w.count).toBeLessThanOrEqual(WEEK_MAX);
      expect(w.count).toBeGreaterThanOrEqual(WEEK_COUNT);
      expect(windowCovers(w, visible)).toBe(true);
    }
  });

  it("never lets the window shrink below its initial size", () => {
    let w = weekWindowFor(anchor, 0);
    for (let i = 0; i < 12; i++) {
      w = slideWeekWindow(w, 1, anchor);
      expect(w.count).toBeGreaterThanOrEqual(WEEK_COUNT);
    }
  });
});

describe("windowCovers", () => {
  const w = { from: 1_000, count: 3 };

  it("includes the first day and excludes the day after the last", () => {
    expect(windowCovers(w, 1_000)).toBe(true);
    expect(windowCovers(w, 1_000 + 3 * DAY - 1)).toBe(true);
    expect(windowCovers(w, 1_000 + 3 * DAY)).toBe(false);
  });
});
