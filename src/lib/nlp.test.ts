import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./nlp";

// Saturday, October 17 2026, 10:00 local time
const NOW = new Date(2026, 9, 17, 10, 0).getTime();

describe("parseQuickAdd", () => {
  it("parses a timed event with duration, tag and priority", () => {
    const parsed = parseQuickAdd("chem lab fri 2pm for 90m #exam !1", NOW);
    expect(parsed.type).toBe("event");
    expect(parsed.title).toBe("chem lab");
    expect(parsed.start).toBe(new Date(2026, 9, 23, 14, 0).getTime());
    expect(parsed.end! - parsed.start!).toBe(90 * 60_000);
    expect(parsed.tagNames).toEqual(["exam"]);
    expect(parsed.priority).toBe(3);
    expect(parsed.summary.join(" ")).toContain("90 min");
  });

  it("parses a due date without a time as a task", () => {
    const parsed = parseQuickAdd("read ch 4 tomorrow", NOW);
    expect(parsed.type).toBe("task");
    expect(parsed.title).toBe("read ch 4");
    expect(parsed.dueAt).toBe(new Date(2026, 9, 18, 23, 59).getTime());
    expect(parsed.start).toBeNull();
  });

  it("leaves plain text alone", () => {
    const parsed = parseQuickAdd("buy milk", NOW);
    expect(parsed.type).toBe("task");
    expect(parsed.title).toBe("buy milk");
    expect(parsed.dueAt).toBeNull();
    expect(parsed.start).toBeNull();
  });

  it("parses a bare time today", () => {
    const parsed = parseQuickAdd("standup 9:30 am", NOW);
    expect(parsed.type).toBe("event");
    expect(parsed.start).toBe(new Date(2026, 9, 17, 9, 30).getTime());
    expect(parsed.title).toBe("standup");
  });

  it("prints the quick-add preview in the chosen clock", () => {
    const parsed = parseQuickAdd("standup 9:30 am", NOW, "24h");
    expect(parsed.summary.join(" ")).toContain("09:30");
    expect(parsed.summary.join(" ")).not.toContain("AM");
  });

  it("parses month/day dates", () => {
    const parsed = parseQuickAdd("dentist 12/24 3pm", NOW);
    expect(parsed.type).toBe("event");
    expect(new Date(parsed.start!).getMonth()).toBe(11);
    expect(new Date(parsed.start!).getDate()).toBe(24);
    expect(new Date(parsed.start!).getHours()).toBe(15);
  });

  it("parses relative days and projects", () => {
    const parsed = parseQuickAdd("essay in 3 days @school", NOW);
    expect(parsed.type).toBe("task");
    expect(parsed.projectName).toBe("school");
    expect(parsed.title).toBe("essay");
    expect(parsed.dueAt).toBe(new Date(2026, 9, 20, 23, 59).getTime());
  });

  it("maps !3 to low priority", () => {
    const parsed = parseQuickAdd("tidy desk !3", NOW);
    expect(parsed.priority).toBe(1);
    expect(parsed.title).toBe("tidy desk");
  });

  it("recognises tonight as an evening event", () => {
    const parsed = parseQuickAdd("movie tonight", NOW);
    expect(parsed.type).toBe("event");
    expect(new Date(parsed.start!).getHours()).toBe(20);
  });
});
