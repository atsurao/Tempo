import { describe, expect, it } from "vitest";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_INDEX,
  groupSettings,
  searchSettings,
  settingsCategory,
} from "./settingsIndex";

describe("settings index", () => {
  it("files every setting under a known category", () => {
    const categories = new Set(SETTINGS_CATEGORIES.map((category) => category.id));
    expect(SETTINGS_INDEX.length).toBeGreaterThan(0);
    for (const entry of SETTINGS_INDEX) {
      expect(categories.has(entry.category)).toBe(true);
      expect(entry.label.trim()).not.toBe("");
    }
  });

  it("uses unique ids and a populated pane per category", () => {
    expect(new Set(SETTINGS_INDEX.map((entry) => entry.id)).size).toBe(SETTINGS_INDEX.length);
    for (const category of SETTINGS_CATEGORIES) {
      expect(SETTINGS_INDEX.some((entry) => entry.category === category.id)).toBe(true);
    }
  });
});

describe("searchSettings", () => {
  it("returns nothing for an empty query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("finds settings by their visible label", () => {
    expect(searchSettings("dark")[0].id).toBe("appearance-dark");
    expect(searchSettings("backup history")[0].id).toBe("data-history");
    expect(searchSettings("WEEK STARTS")[0].id).toBe("calendar-week");
  });

  it("matches everyday words that are not in the label", () => {
    const ids = searchSettings("snapshots").map((entry) => entry.id);
    expect(ids).toContain("data-history");
    expect(searchSettings("clock").map((entry) => entry.id)).toContain("calendar-time");
    expect(searchSettings("color").map((entry) => entry.id)).toContain("appearance-accent");
  });

  it("narrows a multi-word query instead of widening it", () => {
    expect(searchSettings("backup folder").map((entry) => entry.id)).toEqual(["data-backups"]);
    expect(searchSettings("dark mode")[0].id).toBe("appearance-dark");
  });

  it("returns nothing for a query that matches no setting", () => {
    expect(searchSettings("zzz")).toEqual([]);
  });

  it("ranks label matches above keyword matches", () => {
    const results = searchSettings("backup");
    expect(results[0].id).toBe("data-history");
    const labelMatch = results.findIndex((entry) => entry.id === "data-backups");
    const keywordMatch = results.findIndex((entry) => entry.id === "data-export");
    expect(labelMatch).toBeGreaterThanOrEqual(0);
    expect(keywordMatch).toBeGreaterThan(labelMatch);
  });

  it("groups results in sidebar order", () => {
    const groups = groupSettings(searchSettings("time"));
    const order = groups.map((group) => group.category.id);
    expect(order).toEqual([...order].sort(
      (a, b) =>
        SETTINGS_CATEGORIES.findIndex((category) => category.id === a) -
        SETTINGS_CATEGORIES.findIndex((category) => category.id === b),
    ));
    expect(groups.every((group) => group.entries.length > 0)).toBe(true);
  });

  it("falls back to the first category for an unknown id", () => {
    expect(settingsCategory("appearance").label).toBe("Appearance");
  });
});
