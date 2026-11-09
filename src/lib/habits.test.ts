import { describe, expect, it } from "vitest";
import type { Habit, HabitCheckin } from "../types";
import { DAY, sod } from "./date";
import {
  doneDays,
  habitCompletion,
  habitStreak,
  habitSummary,
  habitsDueOn,
  isHabitDone,
  isHabitDue,
  nextHabitDay,
  recentDays,
} from "./habits";

/** Monday, October 19, 2026. */
const day = (offset = 0, hour = 9): number =>
  sod(new Date(2026, 9, 19 + offset).getTime()) + hour * 3_600_000;

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: "h_1",
  name: "Read",
  days: [1, 2, 3, 4, 5],
  interval: 1,
  color: "#4f46e5",
  start: day(0),
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

const checkin = (habitId: string, at: number): HabitCheckin => ({
  id: `${habitId}:${sod(at)}`,
  habitId,
  day: sod(at),
  createdAt: at,
});

describe("isHabitDue", () => {
  it("runs on its weekdays, starting from its first day", () => {
    const read = habit();
    expect(isHabitDue(read, day(0))).toBe(true);
    expect(isHabitDue(read, day(5))).toBe(false);
    expect(isHabitDue(read, day(-7))).toBe(false);
  });

  it("aligns an every-other-week habit on its starting week", () => {
    const practice = habit({ days: [1], interval: 2 });
    expect(isHabitDue(practice, day(0))).toBe(true);
    expect(isHabitDue(practice, day(7))).toBe(false);
    expect(isHabitDue(practice, day(14))).toBe(true);
  });

  it("is never due once archived", () => {
    expect(isHabitDue(habit({ archivedAt: 5 }), day(0))).toBe(false);
  });

  it("lists the day's habits in rail order", () => {
    const due = habitsDueOn(
      [habit({ id: "b", order: 2 }), habit({ id: "a", order: 1 }), habit({ id: "weekend", days: [0] })],
      day(0),
    );
    expect(due.map((h) => h.id)).toEqual(["a", "b"]);
  });
});

describe("habit history", () => {
  it("records a check-in by habit and day", () => {
    const done = doneDays([checkin("h_1", day(0))]);
    expect(isHabitDone(done, "h_1", day(0))).toBe(true);
    expect(isHabitDone(done, "h_1", day(1))).toBe(false);
    expect(isHabitDone(done, "h_2", day(0))).toBe(false);
  });

  it("draws the last seven days, marking scheduled and done days", () => {
    const week = recentDays(
      habit({ start: day(-14) }),
      [checkin("h_1", day(-3))],
      7,
      day(0, 12),
    );
    expect(week).toHaveLength(7);
    // Seven days ending Monday: Friday is three back.
    expect(week[3].day).toBe(sod(day(-3)));
    expect(week[3].due).toBe(true);
    expect(week[3].done).toBe(true);
    expect(week[4].due).toBe(false);
    expect(week[6].day).toBe(sod(day(0)));
  });

  it("counts a streak back across scheduled weekdays", () => {
    // Wednesday, Thursday and Friday done; Monday is the next scheduled day.
    const checkins = [checkin("h_1", day(-5)), checkin("h_1", day(-4)), checkin("h_1", day(-3))];
    expect(habitStreak(habit({ start: day(-14) }), checkins, day(0, 8))).toBe(3);
  });

  it("does not break a streak for today while today is still open", () => {
    const checkins = [checkin("h_1", day(-4)), checkin("h_1", day(-3))];
    // Monday morning: Monday is scheduled but has not been ticked yet.
    expect(habitStreak(habit({ start: day(-14) }), checkins, day(0, 7))).toBe(2);
  });

  it("breaks a streak on a missed scheduled day", () => {
    const checkins = [checkin("h_1", day(-7)), checkin("h_1", day(-6))];
    // Thursday: Wednesday was scheduled and missed.
    expect(habitStreak(habit({ start: day(-14) }), checkins, day(3, 12))).toBe(0);
  });

  it("skips days the habit does not run on", () => {
    const checkins = [checkin("h_1", day(-4)), checkin("h_1", day(-3))];
    // Monday: the weekend was not scheduled, so Thursday and Friday count.
    expect(habitStreak(habit({ start: day(-14) }), checkins, day(0, 8))).toBe(2);
  });
});

describe("habitCompletion", () => {
  it("measures finished scheduled days in the window", () => {
    const checkins = [checkin("h_1", day(0)), checkin("h_1", day(-1))];
    const daily = habit({ days: [0, 1, 2, 3, 4, 5, 6], start: day(-30) });
    const result = habitCompletion(daily, checkins, 7, day(0, 12));
    expect(result.due).toBe(7);
    expect(result.done).toBe(2);
    expect(result.pct).toBe(29);
  });

  it("reports zero rather than dividing by nothing", () => {
    expect(habitCompletion(habit({ start: day(30) }), [], 7, day(0))).toEqual({
      due: 0,
      done: 0,
      pct: 0,
    });
  });
});

describe("habitSummary", () => {
  it("names everyday, weekday and weekend habits", () => {
    expect(habitSummary(habit({ days: [0, 1, 2, 3, 4, 5, 6] }))).toBe("Every day");
    expect(habitSummary(habit())).toBe("Weekdays");
    expect(habitSummary(habit({ days: [0, 6] }))).toBe("Weekends");
    expect(habitSummary(habit({ days: [1, 3, 5] }))).toBe("Every Mon, Wed, Fri");
    expect(habitSummary(habit({ days: [1], interval: 2 }))).toBe("Every 2 weeks on Mon");
  });

  it("says when no days are set", () => {
    expect(habitSummary(habit({ days: [] }))).toBe("No days set");
  });
});

describe("nextHabitDay", () => {
  it("finds today when it is due", () => {
    expect(nextHabitDay(habit(), day(0, 12))).toBe(sod(day(0)));
  });

  it("looks ahead to the next scheduled weekday", () => {
    expect(nextHabitDay(habit(), day(5, 12))).toBe(sod(day(7)));
  });

  it("returns null when the week has no days", () => {
    expect(nextHabitDay(habit({ days: [] }), day(0))).toBeNull();
  });

  it("knows a day off is not a check-in", () => {
    expect(isHabitDone([], "h_1", day(0) + DAY)).toBe(false);
  });
});
