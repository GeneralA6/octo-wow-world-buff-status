import { describe, expect, it, vi } from "vitest";
import { conversationsFor } from "./banter-lines.js";
import { Banter, LINE_GAP_MS } from "./banter.js";
import { ListenerRoster, type ListenerVoice } from "./listener-roster.js";

type SayMock = ReturnType<typeof vi.fn<(line: string) => void>>;

function voice(): { voice: ListenerVoice; say: SayMock } {
  const say = vi.fn<(line: string) => void>();
  return { voice: { say, healerNearby: vi.fn(async () => null) }, say };
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
    expect(held).toEqual({ faction: "horde", between: ["Onyxiabuffog", "Onybuffogb"], kind: conversation?.kind, finished: true });
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
