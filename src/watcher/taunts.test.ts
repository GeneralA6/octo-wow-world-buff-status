import { describe, expect, it } from "vitest";
import { tauntCount, tauntFor } from "./taunts.js";

const KINDS = ["inferno-cast", "infernal", "shunned-player"] as const;
const first = (): number => 0;

/** Every line of a kind, as said to `name`. */
const allLines = (kind: (typeof KINDS)[number], name: string | null): string[] =>
  Array.from({ length: tauntCount(kind) }, (_, index) => tauntFor(kind, name, () => index));

describe("tauntFor", () => {
  it("names the warlock behind an Inferno when known", () => {
    expect(tauntFor("inferno-cast", "Zezerver", first)).toBe("Bold of you to bring fire to a Frost mage, Zezerver. Blink!");
  });

  it("reads right without a name", () => {
    expect(tauntFor("inferno-cast", null, first)).toBe("Bold of you to bring fire to a Frost mage. Blink!");
    expect(tauntFor("inferno-cast", null, () => 1)).toBe("I'd Polymorph your Infernal, but the sheep deserve better.");
    expect(tauntFor("shunned-player", null, first)).toBe("Oh look, someone from the Wall of Shame. Invisibility, please.");
    for (const kind of KINDS) {
      for (const line of allLines(kind, null)) expect(line).not.toMatch(/null|undefined|, \./);
    }
  });

  it("has at least a dozen lines for every kind of threat, all different", () => {
    for (const kind of KINDS) {
      const lines = allLines(kind, "Zezerver");
      expect(lines.length).toBeGreaterThanOrEqual(13);
      expect(new Set(lines).size).toBe(lines.length);
    }
  });

  it("never picks past either end", () => {
    const count = tauntCount("inferno-cast");
    expect(tauntFor("inferno-cast", "Zezerver", () => count + 5)).toBe(tauntFor("inferno-cast", "Zezerver", () => count - 1));
    expect(tauntFor("inferno-cast", "Zezerver", () => -5)).toBe(tauntFor("inferno-cast", "Zezerver", first));
  });

  it("never says how long the listener will be gone", () => {
    for (const kind of KINDS) {
      for (const line of allLines(kind, "Zezerver")) {
        expect(line).not.toMatch(/[0-9]|minute|brb|in a (bit|while)|back in/i);
      }
    }
  });

  it("keeps every line to plain ASCII and one short /say", () => {
    for (const kind of KINDS) {
      for (const line of [...allLines(kind, "Zezerverlongname"), ...allLines(kind, null)]) {
        expect(line).toMatch(/^[\x20-\x7e]+$/);
        expect(line.length).toBeLessThanOrEqual(255);
      }
    }
  });
});
