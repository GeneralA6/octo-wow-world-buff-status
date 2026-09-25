import { describe, expect, it } from "vitest";
import { spireReadDue } from "./read-cadence.js";

const SEC = 1_000;

describe("spireReadDue", () => {
  it("reads at once when it never has", () => {
    expect(spireReadDue(null, 0, 60 * SEC, 0.15)).toBe(true);
  });

  it("takes a lair poll that came a little early by the jitter", () => {
    expect(spireReadDue(0, 52 * SEC, 60 * SEC, 0.15)).toBe(true);
    expect(spireReadDue(0, 51 * SEC, 60 * SEC, 0.15)).toBe(true);
  });

  it("skips a poll well inside the interval", () => {
    expect(spireReadDue(0, 50 * SEC, 60 * SEC, 0.15)).toBe(false);
    expect(spireReadDue(0, 20 * SEC, 60 * SEC, 0.15)).toBe(false);
  });
});
