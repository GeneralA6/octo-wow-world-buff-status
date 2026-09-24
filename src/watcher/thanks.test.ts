import { describe, expect, it } from "vitest";
import { THANKS_COUNT, thanksFor } from "./thanks.js";

/** Every thank-you, as said to `name`. */
const allLines = (name: string | null): string[] =>
  Array.from({ length: THANKS_COUNT }, (_, index) => thanksFor(name, () => index));

describe("thanksFor", () => {
  it("thanks the player by name", () => {
    expect(thanksFor("Healbot", () => 0)).toBe("Thank you, Healbot! Have some conjured water on me.");
  });

  it("reads right without a name", () => {
    expect(thanksFor(null, () => 0)).toBe("Thank you! Have some conjured water on me.");
    expect(thanksFor(null, () => 2)).toBe("Back on my feet. I owe you a Portal.");
    for (const line of allLines(null)) expect(line).not.toMatch(/null|undefined|, [.!]/);
  });

  it("has more than a dozen lines, all different", () => {
    const lines = allLines("Healbot");
    expect(lines.length).toBeGreaterThanOrEqual(14);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("never picks past either end", () => {
    expect(thanksFor("Healbot", () => THANKS_COUNT + 3)).toBe(thanksFor("Healbot", () => THANKS_COUNT - 1));
    expect(thanksFor("Healbot", () => -1)).toBe(thanksFor("Healbot", () => 0));
  });

  it("keeps every line to plain ASCII and one short /say", () => {
    for (const line of [...allLines("Healbotwithalongname"), ...allLines(null)]) {
      expect(line).toMatch(/^[\x20-\x7e]+$/);
      expect(line.length).toBeLessThanOrEqual(255);
    }
  });
});
