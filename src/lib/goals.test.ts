import { describe, expect, it } from "vitest";
import type { Goal } from "../types";
import {
  goalCoversDay,
  goalDateLabel,
  goalDeadlineKey,
  goalDueOnDay,
  goalElapsed,
  goalEnd,
  goalRange,
  goalTimeLabel,
  goalsInRange,
  groupBySpan,
  isGoalDone,
  sortGoals,
  spanLabel,
} from "./goals";
import { DAY, sod } from "./date";

function at(y: number, mo: number, d: number, h = 0): number {
  return new Date(y, mo - 1, d, h).getTime();
}

function goal(patch: Partial<Goal> = {}): Goal {
  const start = patch.start ?? at(2026, 9, 1);
  return {
    id: "g1",
    title: "Ship something",
    span: "month",
    start,
    end: goalEnd(patch.span ?? "month", start),
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

describe("goalEnd", () => {
  it("runs a month-long goal to the end of the following month's eve", () => {
    const end = goalEnd("month", at(2026, 9, 1))!;
    expect(new Date(end).getMonth()).toBe(8); // September
    expect(new Date(end).getDate()).toBe(30);
    expect(new Date(end).getHours()).toBe(23);
  });

  it("runs a year-long goal a full calendar year", () => {
    const end = goalEnd("year", at(2026, 1, 1))!;
    expect(new Date(end).getFullYear()).toBe(2026);
    expect(new Date(end).getMonth()).toBe(11);
    expect(new Date(end).getDate()).toBe(31);
  });

  it("leaves a goal that runs until completion open", () => {
    expect(goalEnd("open", at(2026, 9, 1))).toBeNull();
    expect(goalRange(goal({ span: "open" })).end).toBeNull();
  });

  it("keeps a stored end date instead of recomputing it", () => {
    const stored = at(2026, 12, 24, 23);
    expect(goalRange(goal({ end: stored })).end).toBe(stored);
  });
});

describe("goalCoversDay", () => {
  const month = goal({ start: at(2026, 9, 10) });

  it("covers every day between its start and its horizon", () => {
    expect(goalCoversDay(month, sod(at(2026, 9, 10)))).toBe(true);
    expect(goalCoversDay(month, sod(at(2026, 10, 5)))).toBe(true);
    expect(goalCoversDay(month, sod(at(2026, 10, 9)))).toBe(true);
  });

  it("stops at the edges", () => {
    expect(goalCoversDay(month, sod(at(2026, 9, 9)))).toBe(false);
    expect(goalCoversDay(month, sod(at(2026, 10, 11)))).toBe(false);
  });

  it("never stops for an open goal, however far out the day is", () => {
    const open = goal({ span: "open", start: at(2025, 3, 2) });
    expect(goalCoversDay(open, sod(at(2030, 1, 1)))).toBe(true);
  });
});

describe("goalDeadlineKey and goalDueOnDay", () => {
  it("marks only the final day of a bounded goal", () => {
    const g = goal({ start: at(2026, 9, 10) });
    const deadline = goalDeadlineKey(g)!;
    expect(deadline).toBe(sod(at(2026, 10, 9)));
    expect(goalDueOnDay(g, sod(at(2026, 10, 9)))).toBe(true);
    expect(goalDueOnDay(g, sod(at(2026, 10, 8)))).toBe(false);
    expect(goalDueOnDay(g, sod(at(2026, 10, 10)))).toBe(false);
  });

  it("gives an open goal no deadline to mark", () => {
    const open = goal({ span: "open", start: at(2026, 9, 10) });
    expect(goalDeadlineKey(open)).toBeNull();
    expect(goalDueOnDay(open, sod(at(2026, 12, 31)))).toBe(false);
  });
});

describe("goalsInRange", () => {
  it("keeps goals that overlap the window and drops the rest", () => {
    const inside = goal({ id: "in", start: at(2026, 9, 10) });
    const before = goal({ id: "before", start: at(2026, 5, 1), end: at(2026, 5, 31) });
    const open = goal({ id: "open", span: "open", start: at(2025, 1, 1) });

    const found = goalsInRange([inside, before, open], sod(at(2026, 9, 1)), at(2026, 9, 30));
    expect(found.map((g) => g.id).sort()).toEqual(["in", "open"]);
  });
});

describe("goalElapsed and goalTimeLabel", () => {
  it("reports halfway through a bounded goal", () => {
    const g = goal({ start: at(2026, 9, 1) });
    const end = goalRange(g).end!;
    const mid = g.start + (end - g.start) / 2;
    expect(goalElapsed(g, mid)).toBeCloseTo(0.5, 2);
  });

  it("clamps outside the horizon", () => {
    const g = goal({ start: at(2026, 9, 1) });
    expect(goalElapsed(g, g.start - 10 * DAY)).toBe(0);
    expect(goalElapsed(g, g.start + 400 * DAY)).toBe(1);
  });

  it("has no progress to report for an open goal", () => {
    expect(goalElapsed(goal({ span: "open" }), Date.now())).toBeNull();
  });

  it("counts time left in days and months", () => {
    const g = goal({ start: at(2026, 9, 1) });
    const end = goalRange(g).end!;
    expect(goalTimeLabel(g, end - 3 * DAY)).toBe("3 days left");
    expect(goalTimeLabel(g, end)).toBe("last day");
    expect(goalTimeLabel(goal({ span: "open" }), end)).toBe("until done");
    expect(goalTimeLabel(g, end + 4 * DAY)).toBe("ended 4 days ago");
  });
});

describe("goalDateLabel", () => {
  it("describes a bounded range and an open goal differently", () => {
    expect(goalDateLabel(goal({ start: at(2026, 9, 1) }))).toContain("–");
    expect(goalDateLabel(goal({ span: "open", start: at(2026, 9, 1) }))).toContain("since");
  });
});

describe("sortGoals and groupBySpan", () => {
  it("puts active goals before completed ones, month before year before open", () => {
    const open = goal({ id: "open", span: "open" });
    const year = goal({ id: "year", span: "year" });
    const done = goal({ id: "done", span: "month", completedAt: at(2026, 9, 20) });
    const month = goal({ id: "month", span: "month" });

    expect(sortGoals([open, year, done, month]).map((g) => g.id)).toEqual([
      "month",
      "year",
      "open",
      "done",
    ]);
  });

  it("groups only the spans that have active goals, in span order", () => {
    const groups = groupBySpan([
      goal({ id: "a", span: "year" }),
      goal({ id: "b", span: "open" }),
      goal({ id: "c", span: "month" }),
      goal({ id: "d", span: "year", completedAt: 1 }),
    ]);
    expect(groups.map((g) => g.span)).toEqual(["month", "year", "open"]);
    expect(groups[1].goals.map((g) => g.id)).toEqual(["a"]);
    expect(groups.flatMap((g) => g.goals).some((g) => g.id === "d")).toBe(false);
  });

  it("treats a completed goal as done", () => {
    expect(isGoalDone(goal({ completedAt: 5 }))).toBe(true);
    expect(isGoalDone(goal())).toBe(false);
  });
});

describe("spanLabel", () => {
  it("names each span the way the picker does", () => {
    expect(spanLabel("month")).toBe("This month");
    expect(spanLabel("year")).toBe("This year");
    expect(spanLabel("open")).toBe("Until completion");
  });
});
