import { describe, expect, it } from "vitest";
import { postponedDueAt } from "./postpone";

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m, d, h, min).getTime();

describe("postponedDueAt", () => {
  it("moves to the chosen day while preserving the time of day", () => {
    const task = { dueAt: at(2026, 10, 2, 17, 30), dueAllDay: false };
    const next = postponedDueAt(task, at(2026, 10, 9, 12));
    expect(next).not.toBeNull();
    const date = new Date(next!);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(10);
    expect(date.getDate()).toBe(9);
    expect(date.getHours()).toBe(17);
    expect(date.getMinutes()).toBe(30);
  });

  it("keeps an all-day deadline at the end of the new day", () => {
    const task = { dueAt: at(2026, 10, 2, 23, 59), dueAllDay: true };
    const day = at(2026, 10, 9);
    const next = postponedDueAt(task, day);
    const date = new Date(next!);
    expect(date.getDate()).toBe(9);
    expect(date.getHours()).toBe(23);
    expect(date.getMinutes()).toBe(59);
  });

  it("treats the end-of-day sentinel as an all-day deadline", () => {
    const task = { dueAt: at(2026, 10, 2, 23, 59), dueAllDay: false };
    const next = postponedDueAt(task, at(2026, 10, 9));
    expect(new Date(next!).getHours()).toBe(23);
    expect(new Date(next!).getMinutes()).toBe(59);
  });

  it("has nothing to move when the task has no due date", () => {
    expect(postponedDueAt({ dueAt: null, dueAllDay: false }, Date.now())).toBeNull();
  });
});
