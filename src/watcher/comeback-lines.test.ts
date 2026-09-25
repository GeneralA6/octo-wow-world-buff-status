import { describe, expect, it } from "vitest";
import { COMEBACKS, SOLO_COMEBACKS } from "./comeback-lines.js";

describe("COMEBACKS", () => {
  it("has the partner welcome the one brought back, and it answer", () => {
    expect(COMEBACKS.length).toBeGreaterThanOrEqual(15);
    for (const comeback of COMEBACKS) {
      expect(comeback.lines[0]?.[0]).toBe("a");
      expect(new Set(comeback.lines.map(([part]) => part))).toEqual(new Set(["a", "b"]));
    }
  });

  it("opens every welcome differently", () => {
    const openings = COMEBACKS.map((comeback) => comeback.lines[0]?.[1]);
    expect(new Set(openings).size).toBe(openings.length);
  });
});

describe("SOLO_COMEBACKS", () => {
  it("has a dozen different lines for one with no partner to hear it", () => {
    expect(SOLO_COMEBACKS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SOLO_COMEBACKS).size).toBe(SOLO_COMEBACKS.length);
  });
});

describe("every comeback line", () => {
  it("is plain ASCII and one short /say", () => {
    const lines = [...COMEBACKS.flatMap((comeback) => comeback.lines.map(([, line]) => line)), ...SOLO_COMEBACKS];
    for (const line of lines) {
      expect(line).toMatch(/^[\x20-\x7e]+$/);
      expect(line.length).toBeLessThanOrEqual(120);
    }
  });
});
