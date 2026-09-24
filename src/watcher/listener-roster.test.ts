import { describe, expect, it, vi } from "vitest";
import { ListenerRoster, type ListenerVoice } from "./listener-roster.js";

const voice = (): ListenerVoice => ({ say: vi.fn(), healerNearby: vi.fn(async () => null) });

describe("ListenerRoster", () => {
  it("offers the living listeners of a capital in world to speak, but for one", () => {
    const roster = new ListenerRoster();
    const og = voice();
    const ogb = voice();
    roster.life("Onyxiabuffog", "horde", true);
    roster.life("Onybuffogb", "horde", true);
    roster.life("Onyxiabuffsw", "alliance", true);
    roster.voice("Onyxiabuffog", og);
    roster.voice("Onybuffogb", ogb);
    roster.voice("Onyxiabuffsw", voice());

    expect(roster.speakers("horde").map((s) => s.name)).toEqual(["Onyxiabuffog", "Onybuffogb"]);
    expect(roster.speakers("horde", "Onyxiabuffog").map(({ name, voice }) => ({ name, voice }))).toEqual([
      { name: "Onybuffogb", voice: ogb },
    ]);
  });

  it("starts a listener on a new stint whenever it dies, comes back, leaves or returns", () => {
    const roster = new ListenerRoster();
    roster.life("Onyxiabuffog", "horde", true);
    roster.voice("Onyxiabuffog", voice());
    const stint = (): number | undefined => roster.speakers("horde")[0]?.stint;
    const first = stint();

    roster.life("Onyxiabuffog", "horde", true); // told again it is alive: nothing changed
    expect(stint()).toBe(first);

    roster.life("Onyxiabuffog", "horde", false);
    roster.life("Onyxiabuffog", "horde", true); // died and brought straight back
    const afterRez = stint();
    expect(afterRez).not.toBe(first);

    roster.voice("Onyxiabuffog", null);
    roster.voice("Onyxiabuffog", voice()); // dropped and logged straight back in
    expect(stint()).not.toBe(afterRez);
  });

  it("passes over a listener that is dead or out of the world", () => {
    const roster = new ListenerRoster();
    roster.life("Onyxiabuffog", "horde", false);
    roster.voice("Onyxiabuffog", voice());
    roster.life("Onybuffogb", "horde", true); // alive, but no voice: stood down
    expect(roster.speakers("horde")).toEqual([]);
    expect(roster.dead()).toEqual([{ name: "Onyxiabuffog", faction: "horde" }]);
    expect(roster.isAlive("Onybuffogb")).toBe(true);
    expect(roster.isAlive("Onyxiabuffog")).toBe(false);
  });

  it("follows a listener leaving the world and coming back to life", () => {
    const roster = new ListenerRoster();
    const og = voice();
    roster.life("Onyxiabuffog", "horde", false);
    roster.voice("Onyxiabuffog", og);
    roster.life("Onyxiabuffog", "horde", true);
    expect(roster.speakers("horde").map((s) => s.name)).toEqual(["Onyxiabuffog"]);
    roster.voice("Onyxiabuffog", null);
    expect(roster.speakers("horde")).toEqual([]);
    expect(roster.dead()).toEqual([]);
  });
});
