import { describe, expect, it } from "vitest";
import { tauntFor } from "./taunts.js";

const first = (): number => 0;

describe("tauntFor", () => {
  it("names the warlock behind an Inferno when known", () => {
    expect(tauntFor("inferno-cast", "Zezerver", first)).toBe("Nice try, Zezerver. Your Infernal can have the spot - back in 5.");
  });

  it("reads right without a name", () => {
    expect(tauntFor("inferno-cast", null, first)).toBe("Nice try. Your Infernal can have the spot - back in 5.");
    expect(tauntFor("shunned-player", null, first)).toBe("Oh look, someone from the Wall of Shame. I'll come back when you're gone.");
  });

  it("has a line for every kind of threat", () => {
    for (const kind of ["inferno-cast", "infernal", "shunned-player"] as const) {
      expect(tauntFor(kind, "Zezerver", first).length).toBeGreaterThan(0);
    }
  });

  it("varies the line, and never picks past the end", () => {
    const lines = new Set([0, 1, 2, 3, 99, -5].map((index) => tauntFor("inferno-cast", "Zezerver", () => index)));
    expect(lines.size).toBe(4);
  });

  it("keeps every line to plain ASCII and one short /say", () => {
    for (const kind of ["inferno-cast", "infernal", "shunned-player"] as const) {
      for (let index = 0; index < 5; index += 1) {
        const line = tauntFor(kind, "Zezerverlongname", () => index);
        expect(line).toMatch(/^[\x20-\x7e]+$/);
        expect(line.length).toBeLessThanOrEqual(255);
      }
    }
  });
});
