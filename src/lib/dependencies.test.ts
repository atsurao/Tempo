import { describe, expect, it } from "vitest";
import { wouldCreateDependencyCycle } from "./dependencies";
import type { TaskDependency } from "../types";

let seq = 0;
function link(predecessorId: string, successorId: string): TaskDependency {
  seq += 1;
  return {
    id: `dep-${seq}`,
    workProjectId: "p1",
    predecessorId,
    successorId,
    type: "FS",
    lagDays: 0,
    createdAt: 0,
  };
}

describe("wouldCreateDependencyCycle", () => {
  it("allows a link that extends a chain", () => {
    expect(wouldCreateDependencyCycle([link("a", "b")], "b", "c")).toBe(false);
  });

  it("blocks a link that closes a chain", () => {
    const deps = [link("a", "b"), link("b", "c")];
    expect(wouldCreateDependencyCycle(deps, "c", "a")).toBe(true);
  });

  it("blocks a task depending on itself", () => {
    expect(wouldCreateDependencyCycle([], "a", "a")).toBe(true);
  });

  it("reports a loop regardless of link direction in the input", () => {
    const deps = [link("b", "a"), link("c", "b")];
    expect(wouldCreateDependencyCycle(deps, "a", "c")).toBe(true);
  });

  it("ignores the link being retargeted", () => {
    const first = link("a", "b");
    const second = link("b", "c");
    expect(wouldCreateDependencyCycle([first, second], "c", "a", first.id)).toBe(false);
  });
});
