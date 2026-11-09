import { describe, expect, it } from "vitest";
import {
  eod,
  hourLaterSameDay,
  monthGridRange,
  monthSpanRange,
  rangeLabel,
  yearRange,
  yearSpanRange,
  yearWindow,
} from "./date";

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m, d, h, min).getTime();

describe("yearRange", () => {
  it("spans the whole calendar year around the anchor", () => {
    const { from, to } = yearRange(at(2026, 9, 17, 13, 30));
    expect(new Date(from).getFullYear()).toBe(2026);
    expect(new Date(from).getMonth()).toBe(0);
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(to).getFullYear()).toBe(2026);
    expect(new Date(to).getMonth()).toBe(11);
    expect(new Date(to).getDate()).toBe(31);
    expect(new Date(to).getHours()).toBe(23);
    expect(new Date(to).getMinutes()).toBe(59);
  });

  it("keeps a January 1st anchor inside the same year", () => {
    const { from, to } = yearRange(at(2027, 0, 1));
    expect(new Date(from).getFullYear()).toBe(2027);
    expect(new Date(to).getFullYear()).toBe(2027);
  });
});

describe("eod", () => {
  it("keeps a 23:59 due time inside a 25-hour fall-back day", () => {
    const dayStart = new Date(2026, 10, 1).getTime();
    const due = new Date(2026, 10, 1, 23, 59).getTime();
    expect(eod(dayStart)).toBeGreaterThanOrEqual(due);
    expect(new Date(eod(dayStart)).getDate()).toBe(1);
  });
});

describe("hourLaterSameDay", () => {
  it("moves a normal time forward by an hour", () => {
    const ts = at(2026, 9, 12, 22, 30);
    expect(hourLaterSameDay(ts)).toBe(at(2026, 9, 12, 23, 30));
  });

  it("keeps a late-evening time on its original day", () => {
    const ts = at(2026, 9, 12, 23, 30);
    expect(hourLaterSameDay(ts)).toBe(ts);
  });

  it("keeps an all-day due time on its original day", () => {
    const ts = at(2026, 9, 12, 23, 59);
    expect(hourLaterSameDay(ts)).toBe(ts);
  });
});

describe("rangeLabel", () => {
  it("collapses a single day", () => {
    expect(rangeLabel(at(2026, 9, 12), at(2026, 9, 12, 23, 59))).toBe("Oct 12, 2026");
  });

  it("keeps both ends within one month", () => {
    expect(rangeLabel(at(2026, 9, 12), at(2026, 9, 18))).toBe("Oct 12 – 18, 2026");
  });

  it("names the month again when it changes", () => {
    expect(rangeLabel(at(2026, 8, 28), at(2026, 9, 4))).toBe("Sep 28 – Oct 4, 2026");
  });

  it("keeps both years when it crosses one", () => {
    expect(rangeLabel(at(2026, 11, 28), at(2027, 0, 3))).toBe("Dec 28, 2026 – Jan 3, 2027");
  });
});

describe("monthGridRange", () => {
  it("starts on Sunday or Monday by preference", () => {
    const sunday = monthGridRange(at(2026, 9, 17), 0);
    const monday = monthGridRange(at(2026, 9, 17), 1);
    expect(new Date(sunday.from).getDay()).toBe(0);
    expect(new Date(monday.from).getDay()).toBe(1);
    expect(sunday.from).toBeLessThan(monday.from);
  });

  it("covers 42 days of cells", () => {
    const { from, to } = monthGridRange(at(2026, 9, 17), 0);
    const days = Math.round((to - from + 1) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(42);
  });
});

describe("monthSpanRange", () => {
  it("matches monthGridRange for a single month", () => {
    expect(monthSpanRange(at(2026, 9, 17), 1, 0)).toEqual(monthGridRange(at(2026, 9, 17), 0));
  });

  it("covers every month in the span, padded to whole weeks", () => {
    const range = monthSpanRange(at(2026, 9, 1), 3, 0);
    const first = new Date(range.from);
    // October 2026 starts on a Thursday, so its grid opens on Sunday, Sep 27.
    expect([first.getMonth(), first.getDate()]).toEqual([8, 27]);
    expect(first.getDay()).toBe(0);
    // October through December, closed out with the week that holds New Year.
    const last = new Date(range.to);
    expect([last.getFullYear(), last.getMonth(), last.getDate()]).toEqual([2027, 0, 2]);
    expect(last.getHours()).toBe(23);
  });

  it("runs across a year boundary", () => {
    const range = monthSpanRange(at(2026, 10, 1), 4, 1); // November 2026 – February 2027
    expect(new Date(range.from).getDay()).toBe(1);
    expect(range.to).toBeGreaterThanOrEqual(at(2027, 1, 28, 23, 59));
  });
});

describe("yearWindow", () => {
  it("puts the same number of years on each side of the year it is given", () => {
    expect(yearWindow(2026, 2)).toEqual({ from: 2024, to: 2028 });
    expect(yearWindow(2026, 0)).toEqual({ from: 2026, to: 2026 });
  });

  it("counts back across a century boundary", () => {
    expect(yearWindow(2000, 3)).toEqual({ from: 1997, to: 2003 });
  });
});

describe("yearSpanRange", () => {
  it("covers whole days of the first and last year", () => {
    const range = yearSpanRange(2024, 2025);
    expect(range.from).toBe(yearRange(at(2024, 0, 1)).from);
    expect(range.to).toBe(yearRange(at(2025, 0, 1)).to);
  });

  it("ends on the last millisecond of the final year", () => {
    const last = new Date(yearSpanRange(2026, 2026).to);
    expect([last.getFullYear(), last.getMonth(), last.getDate()]).toEqual([2026, 11, 31]);
    expect(last.getHours()).toBe(23);
  });

  it("matches yearRange for a single year", () => {
    expect(yearSpanRange(2024, 2024)).toEqual(yearRange(at(2024, 5, 14)));
  });
});
