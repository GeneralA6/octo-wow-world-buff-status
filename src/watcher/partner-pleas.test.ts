import { describe, expect, it, vi } from "vitest";
import { PartnerPleas, pleaFor } from "./partner-pleas.js";

const first = (): number => 0;

describe("pleaFor", () => {
  it("names the partner lying dead", () => {
    expect(pleaFor("Onyxiabuffog", first)).toBe(
      "Could a kind soul resurrect my partner Onyxiabuffog? They fell right here, guarding the head.",
    );
  });

  it("varies, keeps to plain ASCII and one short /say, and never says how long", () => {
    const lines = new Set([0, 1, 2, 3, 9].map((index) => pleaFor("Onyxiabuffoglongname", () => index)));
    expect(lines.size).toBe(4);
    for (const line of lines) {
      expect(line).toMatch(/^[\x20-\x7e]+$/);
      expect(line.length).toBeLessThanOrEqual(255);
      expect(line).not.toMatch(/[0-9]|minute|hour/i);
    }
  });
});

describe("PartnerPleas", () => {
  function orgrimmar() {
    const pleas = new PartnerPleas(first);
    const ogSays = vi.fn((_line: string) => undefined);
    const ogbSays = vi.fn((_line: string) => undefined);
    pleas.life("Onyxiabuffog", "horde", true);
    pleas.life("Onybuffogb", "horde", true);
    pleas.voice("Onyxiabuffog", ogSays);
    pleas.voice("Onybuffogb", ogbSays);
    return { pleas, ogSays, ogbSays };
  }

  it("has the living partner ask for the dead one", () => {
    const { pleas, ogSays, ogbSays } = orgrimmar();
    pleas.life("Onyxiabuffog", "horde", false);
    expect(pleas.plead()).toEqual([
      { by: "Onybuffogb", for: "Onyxiabuffog", line: pleaFor("Onyxiabuffog", first) },
    ]);
    expect(ogbSays).toHaveBeenCalledWith(pleaFor("Onyxiabuffog", first));
    expect(ogSays).not.toHaveBeenCalled();
  });

  it("says nothing while everyone is alive, and stops once the dead one is back", () => {
    const { pleas, ogbSays } = orgrimmar();
    expect(pleas.plead()).toEqual([]);
    pleas.life("Onyxiabuffog", "horde", false);
    pleas.plead();
    pleas.life("Onyxiabuffog", "horde", true);
    expect(pleas.plead()).toEqual([]);
    expect(ogbSays).toHaveBeenCalledTimes(1);
  });

  it("never asks from another city", () => {
    const pleas = new PartnerPleas(first);
    const swSays = vi.fn((_line: string) => undefined);
    pleas.life("Onyxiabuffog", "horde", false);
    pleas.life("Onyxiabuffsw", "alliance", true);
    pleas.voice("Onyxiabuffsw", swSays);
    expect(pleas.plead()).toEqual([]);
    expect(swSays).not.toHaveBeenCalled();
  });

  it("waits while the partner is dead too, or out of the world", () => {
    const { pleas, ogbSays } = orgrimmar();
    pleas.life("Onyxiabuffog", "horde", false);
    pleas.voice("Onybuffogb", null); // stood down, say
    expect(pleas.plead()).toEqual([]);
    pleas.voice("Onybuffogb", ogbSays);
    pleas.life("Onybuffogb", "horde", false);
    expect(pleas.plead()).toEqual([]);
    expect(ogbSays).not.toHaveBeenCalled();
  });

  it("does not plead for a listener whose city is unknown", () => {
    const pleas = new PartnerPleas(first);
    const says = vi.fn((_line: string) => undefined);
    pleas.life("Wanderer", null, false);
    pleas.life("Onybuffogb", "horde", true);
    pleas.voice("Onybuffogb", says);
    expect(pleas.plead()).toEqual([]);
  });
});
