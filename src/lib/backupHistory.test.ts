import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./desktop";
import { filterHistory, historySummary } from "./backupHistory";

const base: Omit<HistoryEntry, "path" | "writtenAt" | "titles"> = {
  bytes: 1024,
  items: 12,
  calendars: 2,
  goals: 1,
  habits: 0,
  schedules: 1,
  projects: 0,
};

const entries: HistoryEntry[] = [
  {
    ...base,
    path: "/backups/tempo-history/tempo-1.json",
    writtenAt: new Date(2026, 9, 21, 14, 30).getTime(),
    titles: ["Organic Chemistry", "School"],
  },
  {
    ...base,
    path: "/backups/tempo-history/tempo-2.json",
    writtenAt: new Date(2026, 9, 15, 9, 5).getTime(),
    titles: ["Product launch", "Work"],
  },
];

describe("filterHistory", () => {
  it("returns every snapshot for an empty query", () => {
    expect(filterHistory(entries, "  ")).toHaveLength(2);
  });

  it("matches an indexed item or calendar name, case-insensitively", () => {
    expect(filterHistory(entries, "organic")).toEqual([entries[0]]);
    expect(filterHistory(entries, "WORK")).toEqual([entries[1]]);
  });

  it("matches the date, weekday and clock of a snapshot", () => {
    expect(filterHistory(entries, "2026-10-15")).toEqual([entries[1]]);
    expect(filterHistory(entries, "thursday")).toEqual([entries[1]]);
    expect(filterHistory(entries, "2:30 pm")).toEqual([entries[0]]);
  });

  it("returns nothing when no name or moment fits", () => {
    expect(filterHistory(entries, "zzz")).toEqual([]);
  });
});

describe("historySummary", () => {
  it("names only the collections a snapshot actually has", () => {
    expect(historySummary(entries[0])).toBe("12 items · 2 calendars · 1 schedule · 1 goal");
  });

  it("uses singular labels for one", () => {
    expect(
      historySummary({
        ...entries[0],
        items: 1,
        calendars: 1,
        goals: 0,
        schedules: 0,
      }),
    ).toBe("1 item · 1 calendar");
  });
});
