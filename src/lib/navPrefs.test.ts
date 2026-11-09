import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOBILE_HIDDEN,
  DEFAULT_MOBILE_ORDER,
  MOBILE_BAR_LIMIT,
  cleanHidden,
  moveView,
  normalizeOrder,
  reorderVisible,
  toggleBarView,
  visibleViews,
} from "./navPrefs";

const shown = (hidden: string[]) => visibleViews(DEFAULT_MOBILE_ORDER, hidden);

describe("normalizeOrder", () => {
  it("fills in views a saved order never had", () => {
    expect(normalizeOrder(["tasks", "today"])).toEqual([
      "tasks",
      "today",
      "widgets",
      "calendar",
      "habits",
      "projects",
      "goals",
      "notes",
      "focus",
    ]);
  });

  it("drops unknown and duplicate ids", () => {
    expect(normalizeOrder(["today", "today", "calendar", "bogus"])).toEqual([
      "today",
      "calendar",
      "widgets",
      "tasks",
      "habits",
      "projects",
      "goals",
      "notes",
      "focus",
    ]);
  });
});

describe("cleanHidden", () => {
  it("keeps known views only, once each", () => {
    expect(cleanHidden(["notes", "notes", "nope"])).toEqual(["notes"]);
    expect(cleanHidden(undefined)).toEqual([]);
  });
});

describe("visibleViews", () => {
  it("defaults to the four everyday tabs", () => {
    expect(shown(DEFAULT_MOBILE_HIDDEN)).toEqual(["today", "calendar", "tasks", "projects"]);
  });

  it("follows the saved order, not the default one", () => {
    const order = [...DEFAULT_MOBILE_ORDER].reverse();
    expect(visibleViews(order, ["habits", "goals", "projects", "notes"])).toEqual([
      "focus",
      "tasks",
      "calendar",
      "widgets",
      "today",
    ]);
  });
});

describe("moveView", () => {
  it("moves an entry without losing the others", () => {
    expect(moveView(DEFAULT_MOBILE_ORDER, 0, 2).slice(0, 4)).toEqual([
      "widgets",
      "calendar",
      "today",
      "tasks",
    ]);
  });

  it("leaves the order alone for out-of-range moves", () => {
    expect(moveView(DEFAULT_MOBILE_ORDER, 0, 99)).toEqual(DEFAULT_MOBILE_ORDER);
    expect(moveView(DEFAULT_MOBILE_ORDER, 2, 2)).toEqual(DEFAULT_MOBILE_ORDER);
  });
});

describe("reorderVisible", () => {
  it("moves visible views while hidden ones stay in their slots", () => {
    expect(
      reorderVisible(DEFAULT_MOBILE_ORDER, ["habits", "focus"], [
        "projects",
        "today",
        "goals",
        "calendar",
        "tasks",
        "notes",
        "widgets",
      ]),
    ).toEqual([
      "projects",
      "today",
      "goals",
      "calendar",
      "habits",
      "tasks",
      "notes",
      "widgets",
      "focus",
    ]);
  });

  it("ignores a list that would add or drop a view", () => {
    expect(reorderVisible(DEFAULT_MOBILE_ORDER, DEFAULT_MOBILE_HIDDEN, ["today"])).toEqual(
      DEFAULT_MOBILE_ORDER,
    );
    expect(
      reorderVisible(DEFAULT_MOBILE_ORDER, DEFAULT_MOBILE_HIDDEN, [
        "today",
        "calendar",
        "tasks",
        "notes",
      ]),
    ).toEqual(DEFAULT_MOBILE_ORDER);
  });
});

describe("toggleBarView", () => {
  it("moves a view off the bar", () => {
    expect(toggleBarView(DEFAULT_MOBILE_ORDER, DEFAULT_MOBILE_HIDDEN, "tasks")).toEqual([
      ...DEFAULT_MOBILE_HIDDEN,
      "tasks",
    ]);
  });

  it("adds a hidden view back when there is room", () => {
    const hidden = [...DEFAULT_MOBILE_HIDDEN, "tasks" as const];
    expect(toggleBarView(DEFAULT_MOBILE_ORDER, hidden, "notes")).toEqual([
      "habits",
      "goals",
      "focus",
      "widgets",
      "tasks",
    ]);
  });

  it("refuses a fifth tab", () => {
    const full = DEFAULT_MOBILE_ORDER.filter(
      (id) => !["today", "calendar", "tasks", "projects"].includes(id),
    );
    expect(shown(full)).toHaveLength(MOBILE_BAR_LIMIT);
    expect(toggleBarView(DEFAULT_MOBILE_ORDER, full, "goals")).toBeNull();
  });

  it("refuses to empty the bar", () => {
    const hidden = DEFAULT_MOBILE_ORDER.filter((id) => id !== "today");
    expect(shown(hidden)).toEqual(["today"]);
    expect(toggleBarView(DEFAULT_MOBILE_ORDER, hidden, "today")).toBeNull();
  });
});
