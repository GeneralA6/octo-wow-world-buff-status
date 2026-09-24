import { describe, expect, it } from "vitest";
import { conversationsFor } from "./banter-lines.js";

const FACTIONS = ["horde", "alliance"] as const;

describe("conversationsFor", () => {
  it("gives each capital a hundred-odd conversations — its side's and everyone's", () => {
    for (const faction of FACTIONS) expect(conversationsFor(faction).length).toBeGreaterThanOrEqual(100);
  });

  it("keeps each side's own stories to its own capital", () => {
    const horde = conversationsFor("horde").flatMap((c) => c.lines.map(([, line]) => line)).join(" ");
    const alliance = conversationsFor("alliance").flatMap((c) => c.lines.map(([, line]) => line)).join(" ");
    expect(horde).not.toMatch(/Katrana|VanCleef|Mattingly|Hogger/);
    expect(alliance).not.toMatch(/Grom|Mankrik|Thrall|Orgrimmar/);
  });

  it("has jokes and sad stories as well as talk", () => {
    for (const faction of FACTIONS) {
      const kinds = new Set(conversationsFor(faction).map((c) => c.kind));
      expect(kinds).toEqual(new Set(["chat", "joke", "story"]));
    }
  });

  it("gives both listeners a part in every conversation", () => {
    for (const faction of FACTIONS) {
      for (const conversation of conversationsFor(faction)) {
        expect(conversation.lines.length).toBeGreaterThanOrEqual(2);
        expect(new Set(conversation.lines.map(([part]) => part))).toEqual(new Set(["a", "b"]));
      }
    }
  });

  it("mixes quick exchanges with longer tales of six lines", () => {
    for (const faction of FACTIONS) {
      const lengths = conversationsFor(faction).map((c) => c.lines.length);
      expect(lengths.filter((length) => length <= 3).length).toBeGreaterThanOrEqual(10);
      expect(lengths.filter((length) => length >= 6).length).toBeGreaterThanOrEqual(6);
    }
  });

  it("opens every conversation differently", () => {
    for (const faction of FACTIONS) {
      const openings = conversationsFor(faction).map((c) => c.lines[0]?.[1]);
      expect(new Set(openings).size).toBe(openings.length);
    }
  });

  it("keeps every line to plain ASCII and one short /say", () => {
    for (const faction of FACTIONS) {
      for (const conversation of conversationsFor(faction)) {
        for (const [, line] of conversation.lines) {
          expect(line).toMatch(/^[\x20-\x7e]+$/);
          expect(line.length).toBeLessThanOrEqual(120);
        }
      }
    }
  });
});
