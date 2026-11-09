import { describe, expect, it } from "vitest";
import { glideDuration, glideEase, glideTop } from "./glide";

describe("glideDuration", () => {
  it("keeps a floor, so the smallest correction still glides", () => {
    expect(glideDuration(0)).toBe(160);
    expect(glideDuration(1)).toBe(160);
    expect(glideDuration(-4)).toBe(160);
  });

  it("stays quick as the distance grows, and never long", () => {
    expect(glideDuration(100)).toBe(162);
    expect(glideDuration(400)).toBe(228);
    expect(glideDuration(1000)).toBe(300);
    expect(glideDuration(5000)).toBe(300);
  });

  it("grows with distance and is symmetric about the direction", () => {
    expect(glideDuration(300)).toBeGreaterThan(glideDuration(20));
    expect(glideDuration(-300)).toBe(glideDuration(300));
  });
});

describe("glideEase", () => {
  it("runs from rest to rest", () => {
    expect(glideEase(0)).toBe(0);
    expect(glideEase(1)).toBe(1);
  });

  it("clamps anything outside the unit interval", () => {
    expect(glideEase(-3)).toBe(0);
    expect(glideEase(2)).toBe(1);
  });

  it("never goes backwards and never overshoots", () => {
    let previous = 0;
    for (let i = 1; i <= 100; i++) {
      const value = glideEase(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it("eases in and out, rather than starting at full speed", () => {
    // A tenth of the way through the clock is barely any of the travel.
    expect(glideEase(0.1)).toBeLessThan(0.05);
    expect(glideEase(0.5)).toBeCloseTo(0.5, 6);
    expect(glideEase(0.9)).toBeGreaterThan(0.95);
  });
});

describe("glideTop", () => {
  it("lands exactly on the resting offset", () => {
    expect(glideTop(100, 260, 0, 160)).toBe(100);
    expect(glideTop(100, 260, 160, 160)).toBe(260);
    // Past the clock, the resting offset still holds.
    expect(glideTop(100, 260, 999, 160)).toBe(260);
  });

  it("moves forward the whole way when the target is below", () => {
    let previous = 100;
    for (let t = 0; t <= 160; t += 4) {
      const value = glideTop(100, 260, t, 160);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(260);
      previous = value;
    }
  });

  it("glides up as happily as down", () => {
    expect(glideTop(400, 100, 80, 160)).toBeCloseTo(250, 6);
    expect(glideTop(400, 100, 160, 160)).toBe(100);
  });

  it("keeps every frame small enough to read as motion, not a jump", () => {
    // The largest step of a half-month glide, sampled at 60 fps.
    const frame = 1000 / 60;
    let previous = 0;
    let biggest = 0;
    for (let t = 0; t <= 1000; t += frame) {
      const value = glideTop(0, 620, t, glideDuration(620));
      biggest = Math.max(biggest, value - previous);
      previous = value;
    }
    expect(biggest).toBeLessThan(70);
  });

  it("lands straight away when there is no clock to run", () => {
    expect(glideTop(10, 90, 0, 0)).toBe(90);
  });
});
