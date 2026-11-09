import { describe, expect, it } from "vitest";
import { moveWithin, renumber } from "./order";

const rows = ["a", "b", "c", "d"];

describe("moveWithin", () => {
  it("moves a row down and up", () => {
    expect(moveWithin(rows, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveWithin(rows, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the list alone for a no-op or an out-of-range index", () => {
    expect(moveWithin(rows, 2, 2)).toEqual(rows);
    expect(moveWithin(rows, -1, 2)).toEqual(rows);
    expect(moveWithin(rows, 1, 9)).toEqual(rows);
    expect(moveWithin([], 0, 1)).toEqual([]);
  });

  it("does not mutate the source", () => {
    const source = ["a", "b", "c"];
    moveWithin(source, 0, 1);
    expect(source).toEqual(["a", "b", "c"]);
  });

  it("preserves object identity", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const moved = moveWithin([first, second], 1, 0);
    expect(moved[0]).toBe(second);
    expect(moved[1]).toBe(first);
  });
});

describe("renumber", () => {
  it("numbers the rows from zero in their new order", () => {
    const next = renumber([
      { id: "c", order: 2 },
      { id: "a", order: 0 },
      { id: "b", order: 1 },
    ]);
    expect(next.map((row) => [row.id, row.order])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("keeps rows that were already numbered correctly", () => {
    const first = { id: "a", order: 0 };
    const second = { id: "b", order: 1 };
    const next = renumber([first, second]);
    expect(next[0]).toBe(first);
    expect(next[1]).toBe(second);
  });
});
