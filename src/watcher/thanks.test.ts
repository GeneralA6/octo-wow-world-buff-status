import { describe, expect, it } from "vitest";
import { thanksFor } from "./thanks.js";

describe("thanksFor", () => {
  it("thanks the player by name", () => {
    expect(thanksFor("Healbot", () => 0)).toBe("Thank you, Healbot! Have some conjured water on me.");
  });

  it("reads right without a name", () => {
    expect(thanksFor(null, () => 0)).toBe("Thank you! Have some conjured water on me.");
    expect(thanksFor(null, () => 2)).toBe("Back on my feet. I owe you a Portal.");
  });

  it("varies the line, and never picks past the end", () => {
    const lines = new Set([0, 1, 2, 3, 99, -1].map((index) => thanksFor("Healbot", () => index)));
    expect(lines.size).toBe(4);
  });

  it("keeps every line to plain ASCII and one short /say", () => {
    for (let index = 0; index < 4; index += 1) {
      for (const name of ["Healbotwithalongname", null]) {
        const line = thanksFor(name, () => index);
        expect(line).toMatch(/^[\x20-\x7e]+$/);
        expect(line.length).toBeLessThanOrEqual(255);
      }
    }
  });
});
