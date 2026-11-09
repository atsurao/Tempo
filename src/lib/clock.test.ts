import { describe, expect, it } from "vitest";
import {
  clockHour,
  clockHourLabel,
  clockMinutes,
  clockShort,
  clockSpan,
  clockStamp,
  clockTime,
} from "./clock";

const at = (h: number, m = 0) => new Date(2026, 9, 19, h, m).getTime();

describe("clockTime", () => {
  it("prints AM/PM by default", () => {
    expect(clockTime(at(9, 5))).toBe("9:05 AM");
    expect(clockTime(at(13, 30))).toBe("1:30 PM");
    expect(clockTime(at(0, 0))).toBe("12:00 AM");
    expect(clockTime(at(12, 0))).toBe("12:00 PM");
  });

  it("prints 24-hour time when asked", () => {
    expect(clockTime(at(9, 5), "24h")).toBe("09:05");
    expect(clockTime(at(13, 30), "24h")).toBe("13:30");
    expect(clockTime(at(0, 0), "24h")).toBe("00:00");
    expect(clockTime(at(23, 59), "24h")).toBe("23:59");
  });
});

describe("clockShort", () => {
  it("leaves the suffix off for dense chips", () => {
    expect(clockShort(at(9, 5))).toBe("9:05");
    expect(clockShort(at(9, 5), "24h")).toBe("09:05");
  });
});

describe("clockMinutes", () => {
  it("prints a minute offset in the chosen style", () => {
    expect(clockMinutes(9 * 60 + 5)).toBe("9:05 AM");
    expect(clockMinutes(13 * 60 + 30, "24h")).toBe("13:30");
    expect(clockMinutes(0)).toBe("12:00 AM");
    expect(clockMinutes(1440, "24h")).toBe("00:00");
  });
});

describe("clockHour", () => {
  it("names the hour ruler", () => {
    expect(clockHour(9)).toBe("9 AM");
    expect(clockHour(12)).toBe("12 PM");
    expect(clockHour(0)).toBe("12 AM");
    expect(clockHour(13, "24h")).toBe("13:00");
    expect(clockHour(7, "24h")).toBe("07:00");
    expect(clockHour(24, "24h")).toBe("00:00");
  });
});

describe("clockHourLabel", () => {
  it("names the hour without minutes for the time field", () => {
    expect(clockHourLabel(9)).toBe("9 AM");
    expect(clockHourLabel(0)).toBe("12 AM");
    expect(clockHourLabel(12)).toBe("12 PM");
    expect(clockHourLabel(23, "24h")).toBe("23");
    expect(clockHourLabel(0, "24h")).toBe("00");
  });
});

describe("clockStamp", () => {
  it("keeps the date and clock in the chosen style", () => {
    expect(clockStamp(at(9, 5))).toBe("19 Oct 2026 · 9:05 AM");
    expect(clockStamp(at(13, 30), "24h")).toBe("19 Oct 2026 · 13:30");
    expect(clockStamp(at(9, 5), "24h", "EEE, MMM d")).toBe("Mon, Oct 19 · 09:05");
  });
});

describe("clockSpan", () => {
  it("joins both ends in the same style", () => {
    expect(clockSpan(at(9), at(10, 30))).toBe("9:00 AM – 10:30 AM");
    expect(clockSpan(at(9), at(10, 30), "24h")).toBe("09:00 – 10:30");
  });
});
