import { describe, expect, it, vi } from "vitest";
import { conversationsFor } from "./banter-lines.js";
import { Banter, LINE_GAP_MS } from "./banter.js";
import { ListenerRoster, type ListenerVoice, type ShamedBystander } from "./listener-roster.js";
import { SHAME_JOKES, WARLOCK_CLASS_ID } from "./shame-jokes.js";

type SayMock = ReturnType<typeof vi.fn<(line: string) => void>>;

/** A listener's voice, and the players from the wall of shame it can see in earshot. */
function voice(shamed: readonly ShamedBystander[] = []): { voice: ListenerVoice; say: SayMock } {
  const say = vi.fn<(line: string) => void>();
  return { voice: { say, healerNearby: vi.fn(async () => null), shamedNearby: () => shamed }, say };
}

/** The four listeners, all alive and in world. */
function city() {
  const roster = new ListenerRoster();
  const og = voice();
  const ogb = voice();
  const sw = voice();
  const swb = voice();
  for (const [name, faction, { voice: v }] of [
    ["Onyxiabuffog", "horde", og],
    ["Onybuffogb", "horde", ogb],
    ["Onyxiabuffsw", "alliance", sw],
    ["Onybuffswb", "alliance", swb],
  ] as const) {
    roster.life(name, faction, true);
    roster.voice(name, v);
  }
  return { roster, og, ogb, sw, swb };
}

const first = () => 0;
const instantly = async (): Promise<void> => {};

describe("Banter", () => {
  it("has the two listeners of a capital take turns through a conversation", async () => {
    const { roster, og, ogb, sw, swb } = city();
    const held = await new Banter(roster, { pick: first, sleep: instantly }).converse("horde");

    const conversation = conversationsFor("horde")[0];
    expect(held).toEqual({
      faction: "horde",
      between: ["Onyxiabuffog", "Onybuffogb"],
      kind: conversation?.kind,
      about: null,
      finished: true,
    });
    expect(og.say.mock.calls.map(([line]) => line)).toEqual(conversation?.lines.filter(([part]) => part === "a").map(([, line]) => line));
    expect(ogb.say.mock.calls.map(([line]) => line)).toEqual(conversation?.lines.filter(([part]) => part === "b").map(([, line]) => line));
    // Stormwind's pair hears none of it, and says none of it.
    expect(sw.say).not.toHaveBeenCalled();
    expect(swb.say).not.toHaveBeenCalled();
  });

  it("pairs only listeners of the same capital", async () => {
    const roster = new ListenerRoster();
    const og = voice();
    const sw = voice();
    roster.life("Onyxiabuffog", "horde", true);
    roster.voice("Onyxiabuffog", og.voice);
    roster.life("Onyxiabuffsw", "alliance", true);
    roster.voice("Onyxiabuffsw", sw.voice);
    const banter = new Banter(roster, { pick: first, sleep: instantly });

    expect(await banter.converse("horde")).toBeNull();
    expect(await banter.converse("alliance")).toBeNull();
    expect(og.say).not.toHaveBeenCalled();
    expect(sw.say).not.toHaveBeenCalled();
  });

  it("tells each capital its own side's stories", async () => {
    const { roster, sw, swb } = city();
    await new Banter(roster, { pick: first, sleep: instantly }).converse("alliance");
    const said = [...sw.say.mock.calls, ...swb.say.mock.calls].map(([line]) => line);
    expect(said.length).toBeGreaterThan(0);
    const alliance = new Set(conversationsFor("alliance").flatMap((c) => c.lines.map(([, line]) => line)));
    for (const line of said) expect(alliance.has(line)).toBe(true);
  });

  it("waits ten seconds between one line and the next, and none before the first", async () => {
    const { roster } = city();
    const waits: number[] = [];
    await new Banter(roster, { pick: first, sleep: async (ms) => void waits.push(ms) }).converse("horde");
    const lineCount = conversationsFor("horde")[0]?.lines.length ?? 0;
    expect(LINE_GAP_MS).toBe(10_000);
    expect(waits).toEqual(Array.from({ length: lineCount - 1 }, () => LINE_GAP_MS));
  });

  it("stops when a speaker dies mid-conversation", async () => {
    const { roster, og, ogb } = city();
    const banter = new Banter(roster, {
      pick: first,
      sleep: async () => roster.life("Onybuffogb", "horde", false),
    });
    const held = await banter.converse("horde");
    expect(held?.finished).toBe(false);
    expect(og.say).toHaveBeenCalledTimes(1);
    expect(ogb.say).not.toHaveBeenCalled();
  });

  it("stops when the one listening leaves the world", async () => {
    const { roster, og } = city();
    const banter = new Banter(roster, {
      pick: first,
      // After the first answer, the one who opened leaves; the next line is theirs or goes unheard.
      sleep: async () => roster.voice("Onyxiabuffog", null),
    });
    const held = await banter.converse("horde");
    expect(held?.finished).toBe(false);
    expect(og.say).toHaveBeenCalledTimes(1);
  });

  it("drops the conversation when a speaker dies and is brought back between two lines", async () => {
    const { roster, og, ogb } = city();
    const banter = new Banter(roster, {
      pick: first,
      sleep: async () => {
        roster.life("Onybuffogb", "horde", false);
        roster.life("Onybuffogb", "horde", true);
      },
    });
    const held = await banter.converse("horde");
    expect(held?.finished).toBe(false);
    expect(og.say).toHaveBeenCalledTimes(1);
    expect(ogb.say).not.toHaveBeenCalled();
  });

  it("drops the conversation when a speaker drops and logs straight back in between two lines", async () => {
    const { roster, og } = city();
    const again = voice();
    const banter = new Banter(roster, {
      pick: first,
      sleep: async () => {
        roster.voice("Onyxiabuffog", null);
        roster.voice("Onyxiabuffog", again.voice);
      },
    });
    const held = await banter.converse("horde");
    expect(held?.finished).toBe(false);
    expect(og.say).toHaveBeenCalledTimes(1);
    expect(again.say).not.toHaveBeenCalled();
  });

  it("carries on when a speaker is merely told again that it is alive", async () => {
    const { roster } = city();
    const banter = new Banter(roster, { pick: first, sleep: async () => roster.life("Onybuffogb", "horde", true) });
    expect((await banter.converse("horde"))?.finished).toBe(true);
  });

  it("holds one conversation at a time in a capital", async () => {
    const { roster } = city();
    let release: () => void = () => {};
    const banter = new Banter(roster, { pick: first, sleep: () => new Promise((resolve) => (release = resolve)) });
    const talking = banter.converse("horde");
    expect(await banter.converse("horde")).toBeNull();
    // Let the first one run to its end.
    for (let i = 0; i < 10; i++) {
      release();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect((await talking)?.finished).toBe(true);
  });

  it("goes through other conversations before repeating a recent one", async () => {
    const { roster, og, ogb } = city();
    const banter = new Banter(roster, { pick: first, sleep: instantly });
    const count = conversationsFor("horde").length;
    const openings: string[] = [];
    for (let i = 0; i < Math.floor(count / 2) + 1; i++) {
      og.say.mockClear();
      ogb.say.mockClear();
      await banter.converse("horde");
      const opening = og.say.mock.calls[0]?.[0];
      if (opening) openings.push(opening);
    }
    expect(new Set(openings).size).toBe(openings.length);
  });

  it("keeps each capital's memory of recent conversations to itself", async () => {
    const { roster, og, sw } = city();
    const banter = new Banter(roster, { pick: first, sleep: instantly });
    await banter.converse("horde");
    await banter.converse("alliance");
    // Both chose their first conversation: Orgrimmar's having held one leaves Stormwind's choice alone.
    expect(sw.say.mock.calls[0]?.[0]).toBe(conversationsFor("alliance")[0]?.lines[0]?.[1]);
    expect(og.say.mock.calls[0]?.[0]).toBe(conversationsFor("horde")[0]?.lines[0]?.[1]);
  });
});

describe("Banter, with a player from the wall of shame in earshot", () => {
  const WARRIOR = 1;
  const zezerver: ShamedBystander = { name: "Zezerver", classId: WARLOCK_CLASS_ID };

  /** Orgrimmar's pair, each seeing its own shamed players nearby. */
  function orgrimmar(ogSees: readonly ShamedBystander[], ogbSees: readonly ShamedBystander[] = []) {
    const roster = new ListenerRoster();
    const og = voice(ogSees);
    const ogb = voice(ogbSees);
    roster.life("Onyxiabuffog", "horde", true);
    roster.voice("Onyxiabuffog", og.voice);
    roster.life("Onybuffogb", "horde", true);
    roster.voice("Onybuffogb", ogb.voice);
    return { roster, og, ogb };
  }

  const openingsOf = (warlockOnly: boolean, name: string): ReadonlySet<string | undefined> =>
    new Set(SHAME_JOKES.filter((joke) => joke.warlockOnly === warlockOnly).map((joke) => joke.lines(name)[0]?.[1]));

  it("makes fun of them by name when the coin says so", async () => {
    const { roster, og, ogb } = orgrimmar([zezerver]);
    const held = await new Banter(roster, { pick: first, sleep: instantly, tellShameJoke: () => true }).converse("horde");

    expect(held).toMatchObject({ kind: "joke", about: "Zezerver", finished: true });
    const joke = SHAME_JOKES[0]?.lines("Zezerver") ?? [];
    expect(og.say.mock.calls.map(([line]) => line)).toEqual(joke.filter(([part]) => part === "a").map(([, line]) => line));
    expect(ogb.say.mock.calls.map(([line]) => line)).toEqual(joke.filter(([part]) => part === "b").map(([, line]) => line));
  });

  it("goes on with a regular conversation when the coin says otherwise", async () => {
    const { roster, og } = orgrimmar([zezerver]);
    const held = await new Banter(roster, { pick: first, sleep: instantly, tellShameJoke: () => false }).converse("horde");
    expect(held?.about).toBeNull();
    expect(og.say.mock.calls[0]?.[0]).toBe(conversationsFor("horde")[0]?.lines[0]?.[1]);
  });

  it("flips no coin at all with no one from the wall in earshot", async () => {
    const { roster } = orgrimmar([]);
    const tellShameJoke = vi.fn(() => true);
    const held = await new Banter(roster, { pick: first, sleep: instantly, tellShameJoke }).converse("horde");
    expect(tellShameJoke).not.toHaveBeenCalled();
    expect(held?.about).toBeNull();
  });

  it("jokes about a shamed player only one of the pair can see", async () => {
    const { roster } = orgrimmar([], [zezerver]);
    const held = await new Banter(roster, { pick: first, sleep: instantly, tellShameJoke: () => true }).converse("horde");
    expect(held?.about).toBe("Zezerver");
  });

  it("keeps the Infernal jokes for a warlock", async () => {
    const { roster, og } = orgrimmar([{ name: "Brawler", classId: WARRIOR }]);
    const banter = new Banter(roster, { pick: first, sleep: instantly, tellShameJoke: () => true });
    const forAnyone = openingsOf(false, "Brawler");
    for (let i = 0; i < 25; i++) {
      og.say.mockClear();
      await banter.converse("horde");
      expect(forAnyone.has(og.say.mock.calls[0]?.[0])).toBe(true);
    }
  });

  it("goes through the other jokes before telling one again", async () => {
    const { roster, og } = orgrimmar([zezerver]);
    const banter = new Banter(roster, { pick: first, sleep: instantly, tellShameJoke: () => true });
    const openings: string[] = [];
    for (let i = 0; i < SHAME_JOKES.length / 2 + 1; i++) {
      og.say.mockClear();
      await banter.converse("horde");
      const opening = og.say.mock.calls[0]?.[0];
      if (opening) openings.push(opening);
    }
    expect(openings).toHaveLength(SHAME_JOKES.length / 2 + 1);
    expect(new Set(openings).size).toBe(openings.length);
  });
});
