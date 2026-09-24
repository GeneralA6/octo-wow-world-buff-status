import { describe, expect, it, vi } from "vitest";
import {
  HEALER_PLEA_COUNT,
  healerPleaFor,
  PartnerPleas,
  PLEA_COUNT,
  pleaFor,
} from "./partner-pleas.js";
import { ListenerRoster, type ListenerVoice, type NamedHealer } from "./listener-roster.js";

const first = (): number => 0;

describe("pleaFor", () => {
  it("names the partner lying dead", () => {
    expect(pleaFor("Onyxiabuffog", first)).toBe("Rez for Onyxiabuffog? Paying in conjured water.");
  });

  it("has more than a dozen lines, all different, and never picks past the end", () => {
    const lines = Array.from({ length: PLEA_COUNT }, (_, index) => pleaFor("Onyxiabuffog", () => index));
    expect(lines.length).toBeGreaterThanOrEqual(14);
    expect(new Set(lines).size).toBe(lines.length);
    expect(pleaFor("Onyxiabuffog", () => PLEA_COUNT + 2)).toBe(lines.at(-1));
  });

  it("keeps to plain ASCII and one short /say, and never says how long", () => {
    for (let index = 0; index < PLEA_COUNT; index += 1) {
      const line = pleaFor("Onyxiabuffoglongname", () => index);
      expect(line).toMatch(/^[\x20-\x7e]+$/);
      expect(line.length - "Onyxiabuffoglongname".length).toBeLessThanOrEqual(50); // short, not a speech
      expect(line).not.toMatch(/[0-9]|minute|hour/i);
      expect(line).toContain("Onyxiabuffoglongname");
    }
  });
});

describe("healerPleaFor", () => {
  it("asks the healer by name, with their own spell, for the partner", () => {
    expect(healerPleaFor({ name: "Healbot", spell: "Ancestral Spirit" }, "Onyxiabuffog", first)).toBe(
      "Healbot, could you cast Ancestral Spirit on Onyxiabuffog? Water's on me.",
    );
  });

  it("keeps every line short, plain and different", () => {
    const lines = Array.from({ length: HEALER_PLEA_COUNT }, (_, index) =>
      healerPleaFor({ name: "Healbotlongname", spell: "Ancestral Spirit" }, "Onyxiabuffoglong", () => index),
    );
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) {
      expect(line).toMatch(/^[ -~]+$/);
      expect(line.length).toBeLessThanOrEqual(120);
    }
  });
});

/** A listener's part in pleading: what it says, and the healers it can see. */
function voice(healers: readonly NamedHealer[] = []) {
  return {
    say: vi.fn((_line: string) => undefined),
    healerNearby: vi.fn(async (exclude: ReadonlySet<bigint>) => healers.find((h) => !exclude.has(h.guid)) ?? null),
  } satisfies ListenerVoice;
}

describe("PartnerPleas", () => {
  function orgrimmar(healers: readonly NamedHealer[] = []) {
    const roster = new ListenerRoster();
    const pleas = new PartnerPleas(roster, first);
    const og = voice(healers);
    const ogb = voice(healers);
    roster.life("Onyxiabuffog", "horde", true);
    roster.life("Onybuffogb", "horde", true);
    roster.voice("Onyxiabuffog", og);
    roster.voice("Onybuffogb", ogb);
    return { roster, pleas, og, ogb };
  }

  it("has the living partner ask anyone for the dead one when no healer is about", async () => {
    const { roster, pleas, og, ogb } = orgrimmar();
    roster.life("Onyxiabuffog", "horde", false);
    expect(await pleas.plead()).toEqual([
      { by: "Onybuffogb", for: "Onyxiabuffog", healer: null, line: pleaFor("Onyxiabuffog", first) },
    ]);
    expect(ogb.say).toHaveBeenCalledWith(pleaFor("Onyxiabuffog", first));
    expect(og.say).not.toHaveBeenCalled();
  });

  it("asks a healer standing near by name, and never the same one twice a death", async () => {
    const healbot: NamedHealer = { guid: 7n, name: "Healbot", spell: "Resurrection" };
    const totemz: NamedHealer = { guid: 8n, name: "Totemz", spell: "Ancestral Spirit" };
    const { roster, pleas, ogb } = orgrimmar([healbot, totemz]);
    roster.life("Onyxiabuffog", "horde", false);

    expect((await pleas.plead())[0]?.healer).toBe("Healbot");
    expect(ogb.say).toHaveBeenLastCalledWith(healerPleaFor(healbot, "Onyxiabuffog", first));
    expect((await pleas.plead())[0]?.healer).toBe("Totemz");
    expect((await pleas.plead())[0]?.healer).toBeNull(); // both asked: back to asking anyone
  });

  it("asks the healers afresh after the next death", async () => {
    const healbot: NamedHealer = { guid: 7n, name: "Healbot", spell: "Resurrection" };
    const { roster, pleas } = orgrimmar([healbot]);
    roster.life("Onyxiabuffog", "horde", false);
    await pleas.plead();
    roster.life("Onyxiabuffog", "horde", true);
    await pleas.plead(); // alive: nothing asked, and the slate wiped
    roster.life("Onyxiabuffog", "horde", false);
    expect((await pleas.plead())[0]?.healer).toBe("Healbot");
  });

  it("asks anyone when looking for a healer fails", async () => {
    const { roster, pleas, ogb } = orgrimmar();
    ogb.healerNearby.mockRejectedValueOnce(new Error("not in world"));
    roster.life("Onyxiabuffog", "horde", false);
    expect((await pleas.plead())[0]?.healer).toBeNull();
  });

  it("says nothing while everyone is alive, and stops once the dead one is back", async () => {
    const { roster, pleas, ogb } = orgrimmar();
    expect(await pleas.plead()).toEqual([]);
    roster.life("Onyxiabuffog", "horde", false);
    await pleas.plead();
    roster.life("Onyxiabuffog", "horde", true);
    expect(await pleas.plead()).toEqual([]);
    expect(ogb.say).toHaveBeenCalledTimes(1);
  });

  it("never asks from another city", async () => {
    const roster = new ListenerRoster();
    const pleas = new PartnerPleas(roster, first);
    const sw = voice();
    roster.life("Onyxiabuffog", "horde", false);
    roster.life("Onyxiabuffsw", "alliance", true);
    roster.voice("Onyxiabuffsw", sw);
    expect(await pleas.plead()).toEqual([]);
    expect(sw.say).not.toHaveBeenCalled();
  });

  it("waits while the partner is dead too, or out of the world", async () => {
    const { roster, pleas, ogb } = orgrimmar();
    roster.life("Onyxiabuffog", "horde", false);
    roster.voice("Onybuffogb", null); // stood down, say
    expect(await pleas.plead()).toEqual([]);
    roster.voice("Onybuffogb", ogb);
    roster.life("Onybuffogb", "horde", false);
    expect(await pleas.plead()).toEqual([]);
    expect(ogb.say).not.toHaveBeenCalled();
  });

  it("does not plead for a listener whose city is unknown", async () => {
    const roster = new ListenerRoster();
    const pleas = new PartnerPleas(roster, first);
    roster.life("Wanderer", null, false);
    roster.life("Onybuffogb", "horde", true);
    roster.voice("Onybuffogb", voice());
    expect(await pleas.plead()).toEqual([]);
  });
});
