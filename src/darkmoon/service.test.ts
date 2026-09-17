import { describe, expect, it, vi } from "vitest";
import { FaireService, type ObserveOutcome, type ScheduleConflict } from "./service.js";
import { VANILLA_SCHEDULE } from "./schedule.js";
import { InMemoryKnowledgeStore, type KnowledgeStore } from "./knowledge-store.js";
import { DEFAULT_CORROBORATION, type CorroborationPolicy } from "./corroboration.js";
import { NO_KNOWLEDGE, type FaireKnowledge, type FaireObservation } from "./resolve.js";

const utc = (iso: string): number => Date.parse(iso);
/** Mid-week of the Sept 2026 faire (setup the 4th, open the 7th-14th); the anchor calls it Elwynn. */
const NOW = utc("2026-09-10T12:00:00Z");
const AFTER = utc("2026-09-20T12:00:00Z");

const ANNOUNCEMENT = "The Darkmoon Faire is coming! There is fun for children of ALL ages! Come one, come all!";

function makeService(
  store: KnowledgeStore = new InMemoryKnowledgeStore(),
  hooks: {
    onObservation?: (observation: FaireObservation) => void;
    onScheduleConflict?: (conflict: ScheduleConflict) => void;
    corroboration?: CorroborationPolicy;
  } = {},
): FaireService {
  return new FaireService({ schedule: VANILLA_SCHEDULE, store, ...hooks });
}

/** What a real faire week looks like: many distinct clients repeating the same sighting. */
async function flood(
  service: FaireService,
  line: string,
  at: number,
  senders = DEFAULT_CORROBORATION.quorum,
): Promise<ObserveOutcome> {
  const outcomes: ObserveOutcome[] = [];
  for (let i = 0; i < senders; i += 1) {
    outcomes.push(await service.observeChannel(line, `player-${i}`, at));
  }
  // Only the vote that tips the quorum settles; the rest are already-known repeats. Report what
  // the flood as a whole achieved, not what its last voice happened to return.
  return outcomes.includes("accepted") ? "accepted" : (outcomes[outcomes.length - 1] ?? "ignored");
}

describe("FaireService.observeChannel", () => {
  it("accepts a corroborated broadcast and reports from it", async () => {
    const service = makeService();
    expect(await flood(service, "PWB_DMF:10401:M-3600-Someplayer", NOW)).toBe("accepted");
    expect(service.knowledge.sighting).toEqual({
      location: "mulgore",
      windowSetupAt: utc("2026-09-04T00:00:00Z"),
      observedAt: NOW - 3_600_000,
      source: "sighting",
      witness: "Someplayer",
    });
    expect(service.report(NOW).location).toBe("mulgore");
    expect(service.report(NOW).source).toBe("sighting");
  });

  it("ignores the rest of the LFT channel's traffic", async () => {
    const service = makeService();
    expect(await service.observeChannel("OB_INC:1:A-O-Someplayer-14-32", "p1", NOW)).toBe("ignored");
    expect(await service.observeChannel("PWB:1337:A-O-13-37-Pizzahawaii", "p1", NOW)).toBe("ignored");
    expect(await service.observeChannel("LFG Mara need healer", "p1", NOW)).toBe("ignored");
    expect(service.knowledge).toEqual(NO_KNOWLEDGE);
  });

  it("ignores a broadcast from a version with the Carnie bug", async () => {
    const service = makeService();
    expect(await flood(service, "PWB_DMF:10400:M-60-Someplayer", NOW)).toBe("ignored");
    expect(service.knowledge.sighting).toBeNull();
  });

  it("ignores a sighting older than the faire's own visit", async () => {
    const service = makeService();
    expect(await flood(service, `PWB_DMF:10401:M-${8 * 86_400}-Someplayer`, NOW)).toBe("ignored");
    expect(service.knowledge.sighting).toBeNull();
  });

  it("keeps the freshest sighting and writes nothing for the rebroadcast flood", async () => {
    const store = new InMemoryKnowledgeStore();
    const save = vi.spyOn(store, "save");
    const service = makeService(store);

    expect(await flood(service, "PWB_DMF:10401:M-3600-First", NOW)).toBe("accepted");
    // Every other client repeats the same sighting, each with its own drift — none is newer.
    expect(await flood(service, "PWB_DMF:10401:M-3600-First", NOW)).toBe("counted");
    expect(await flood(service, "PWB_DMF:10401:M-7200-Second", NOW)).toBe("counted");
    expect(save).toHaveBeenCalledTimes(1);

    expect(await flood(service, "PWB_DMF:10401:M-60-Third", NOW)).toBe("accepted");
    expect(service.knowledge.sighting?.witness).toBe("Third");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("reports a corroborated sighting the schedule cannot place, and keeps nothing", async () => {
    const onScheduleConflict = vi.fn();
    const service = makeService(new InMemoryKnowledgeStore(), { onScheduleConflict });
    // Seen on a day the vanilla rule says the faire has already left.
    expect(await flood(service, "PWB_DMF:10401:M-60-Someplayer", AFTER)).toBe("counted");
    expect(onScheduleConflict).toHaveBeenCalledWith({
      seenAt: AFTER - 60_000,
      location: "mulgore",
      source: "sighting",
      witness: "Someplayer",
    });
    expect(service.knowledge.sighting).toBeNull();
  });

  it("announces an accepted sighting exactly once", async () => {
    const onObservation = vi.fn();
    const service = makeService(new InMemoryKnowledgeStore(), { onObservation });
    await flood(service, "PWB_DMF:10401:M-3600-Someplayer", NOW);
    await flood(service, "PWB_DMF:10401:M-3600-Someplayer", NOW);
    expect(onObservation).toHaveBeenCalledTimes(1);
    expect(onObservation.mock.calls[0]?.[0]).toMatchObject({ source: "sighting", location: "mulgore" });
  });
});

describe("FaireService tamper resistance", () => {
  it("does not believe one player, however loudly they repeat themselves", async () => {
    const service = makeService();
    for (let i = 0; i < 50; i += 1) {
      expect(await service.observeChannel("PWB_DMF:10401:M-0-Troll", "troll", NOW + i * 1000)).toBe(
        "counted",
      );
    }
    expect(service.knowledge.sighting).toBeNull();
    expect(service.report(NOW).source).toBe("calendar");
  });

  it("will not count a broadcast whose sender cannot be identified", async () => {
    // The sender is the only part of a channel line the server stamps. Without it there is no
    // ballot box, so the line is reported rather than counted — and never silently dropped.
    const service = makeService();
    expect(await service.observeChannel("PWB_DMF:10401:M-0-Troll", "0", NOW)).toBe("unidentified");
    expect(await service.observeChannel("PWB_DMF:10401:M-0-Troll", "", NOW)).toBe("unidentified");
    expect(service.knowledge.sighting).toBeNull();
  });

  it("outvotes a troll who shows up mid-week with a handful of characters", async () => {
    const service = makeService();
    for (let i = 0; i < 8; i += 1) {
      await service.observeChannel("PWB_DMF:10401:E-60-Honest", `player-${i}`, NOW);
    }
    expect(service.report(NOW).location).toBe("elwynn");

    for (const troll of ["troll1", "troll2", "troll3", "troll4"]) {
      await service.observeChannel("PWB_DMF:10401:M-0-Liar", troll, NOW + 60_000);
    }
    // The honest clients still outnumber them, so the majority never moves.
    expect(service.report(NOW + 60_000).location).toBe("elwynn");
  });

  it("holds the zone through the cooldown even if the liars take the majority", async () => {
    const service = makeService();
    await flood(service, "PWB_DMF:10401:E-60-Honest", NOW, 4);
    expect(service.report(NOW).location).toBe("elwynn");

    // A patient troll with more characters than the quiet hour has honest clients.
    const later = NOW + 3_600_000;
    for (let i = 0; i < 12; i += 1) {
      await service.observeChannel("PWB_DMF:10401:M-0-Liar", `sock-${i}`, later);
    }
    expect(service.report(later).location).toBe("elwynn");
    expect(service.knowledge.sighting?.witness).toBe("Honest");
  });

  it("lets the zone move once the cooldown is spent, which is how the real faire moves", async () => {
    const service = makeService();
    await flood(service, "PWB_DMF:10401:E-60-Honest", NOW, 4);

    // Next month's faire, seen by a fresh crowd during October's window.
    const october = utc("2026-10-07T12:00:00Z");
    expect(await flood(service, "PWB_DMF:10401:M-60-Newcomer", october, 4)).toBe("accepted");
    expect(service.report(october).location).toBe("mulgore");
  });

  it("cannot be kept looking live by one player after the faire has left", async () => {
    const service = makeService();
    await flood(service, "PWB_DMF:10401:E-60-Honest", NOW, 4);

    // A day later the faire is still notionally open, but only the troll is claiming a fresh
    // sighting — without quorum it cannot refresh how recently the faire was seen.
    const nextDay = NOW + 86_400_000;
    expect(await service.observeChannel("PWB_DMF:10401:E-0-Troll", "troll", nextDay)).toBe("counted");
    expect(service.knowledge.sighting?.observedAt).toBe(NOW - 60_000);
  });

  it("can be relaxed to PizzaWorldBuffs' own trust-the-latest behaviour", async () => {
    const service = makeService(new InMemoryKnowledgeStore(), {
      corroboration: { quorum: 1, changeCooldownMs: 0 },
    });
    expect(await service.observeChannel("PWB_DMF:10401:M-60-Someplayer", "solo", NOW)).toBe("accepted");
  });
});

describe("FaireService.observeMonsterChat", () => {
  it("accepts a herald and pins the alternation from it", async () => {
    const service = makeService();
    expect(await service.observeMonsterChat("Kruban Darkblade", ANNOUNCEMENT, AFTER)).toBe(true);
    expect(service.knowledge.herald).toMatchObject({
      location: "mulgore",
      source: "herald",
      witness: "Kruban Darkblade",
      windowSetupAt: utc("2026-10-02T00:00:00Z"),
    });
    const october = service.report(utc("2026-10-06T12:00:00Z"));
    expect(october.location).toBe("mulgore");
    expect(october.confirmedBy).toBe("herald");
  });

  it("needs no corroboration, because the server is the one speaking", async () => {
    // A player cannot be the sender of monster chat, so one herald is proof where one channel
    // line is only a vote.
    const service = makeService();
    expect(await service.observeMonsterChat("Kruban Darkblade", ANNOUNCEMENT, AFTER)).toBe(true);
    expect(service.knowledge.herald).not.toBeNull();
  });

  it("ignores every other NPC in the capital", async () => {
    const service = makeService();
    expect(await service.observeMonsterChat("Thrall", "Lok'tar ogar!", NOW)).toBe(false);
    expect(service.knowledge.herald).toBeNull();
  });

  it("does not rewrite itself while the herald repeats the same announcement for a week", async () => {
    const store = new InMemoryKnowledgeStore();
    const save = vi.spyOn(store, "save");
    const service = makeService(store);
    expect(await service.observeMonsterChat("Kruban Darkblade", ANNOUNCEMENT, AFTER)).toBe(true);
    expect(await service.observeMonsterChat("Kruban Darkblade", ANNOUNCEMENT, AFTER + 600_000)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("accepts the herald again once they are announcing a later faire", async () => {
    const service = makeService();
    await service.observeMonsterChat("Kruban Darkblade", ANNOUNCEMENT, AFTER);
    expect(await service.observeMonsterChat("Melnan Darkstone", ANNOUNCEMENT, utc("2026-10-28T12:00:00Z"))).toBe(
      true,
    );
    expect(service.knowledge.herald?.windowSetupAt).toBe(utc("2026-11-06T00:00:00Z"));
  });

  it("keeps the herald when a sighting lands, and prefers it for the alternation", async () => {
    const service = makeService();
    await service.observeMonsterChat("Kruban Darkblade", ANNOUNCEMENT, utc("2026-09-01T12:00:00Z"));
    await flood(service, "PWB_DMF:10401:E-60-Someplayer", NOW, 4);

    expect(service.knowledge.herald).not.toBeNull();
    expect(service.knowledge.sighting).not.toBeNull();
    // The sighting still owns "is it up now" and the zone it reports live...
    expect(service.report(NOW).source).toBe("sighting");
    // ...but the herald, which cannot be forged, owns the alternation for every other month.
    expect(service.report(NOW).confirmedBy).toBe("herald");
    expect(service.report(utc("2026-10-06T12:00:00Z")).location).toBe("elwynn");
  });
});

describe("FaireService.load", () => {
  it("restores observations from a previous run, so the anchor survives a redeploy", async () => {
    const stored: FaireKnowledge = {
      onsite: null,
      herald: null,
      sighting: {
        location: "mulgore",
        windowSetupAt: utc("2026-09-04T00:00:00Z"),
        observedAt: NOW,
        source: "sighting",
        witness: "Someplayer",
      },
    };
    const service = makeService(new InMemoryKnowledgeStore(stored));
    await service.load();

    const october = service.report(utc("2026-10-06T12:00:00Z"));
    expect(october.location).toBe("elwynn");
    expect(october.source).toBe("calendar");
    expect(october.confirmedBy).toBe("sighting");
  });

  it("falls back to the shipped calendar when nothing was ever stored", async () => {
    const service = makeService();
    await service.load();
    const report = service.report(NOW);
    expect(report.location).toBe("elwynn");
    expect(report.source).toBe("calendar");
    expect(report.confirmedBy).toBeNull();
  });
});

describe("FaireService.observeNearbyNpc", () => {
  it("records the faire as here when its staff is standing next to us", async () => {
    const service = makeService();
    expect(await service.observeNearbyNpc("Silas Darkmoon", "elwynn", NOW)).toBe(true);
    expect(service.knowledge.onsite).toMatchObject({
      location: "elwynn",
      source: "onsite",
      witness: "Silas Darkmoon",
      windowSetupAt: utc("2026-09-04T00:00:00Z"),
    });
    const report = service.report(NOW);
    expect(report.source).toBe("onsite");
    expect(report.confirmedBy).toBe("onsite");
  });

  it("needs no corroboration — it is our own client's object stream", async () => {
    const service = makeService();
    expect(await service.observeNearbyNpc("Sayge", "elwynn", NOW)).toBe(true);
  });

  it("ignores NPCs that are not the faire, including the ever-present Carnie", async () => {
    const service = makeService();
    expect(await service.observeNearbyNpc("Innkeeper Farley", "elwynn", NOW)).toBe(false);
    expect(await service.observeNearbyNpc("Darkmoon Faire Carnie", "elwynn", NOW)).toBe(false);
    expect(service.knowledge.onsite).toBeNull();
  });

  it("does not rewrite itself every time the staff re-enters visibility", async () => {
    const store = new InMemoryKnowledgeStore();
    const save = vi.spyOn(store, "save");
    const service = makeService(store);
    expect(await service.observeNearbyNpc("Sayge", "elwynn", NOW)).toBe(true);
    expect(await service.observeNearbyNpc("Sayge", "elwynn", NOW + 60_000)).toBe(false);
    expect(await service.observeNearbyNpc("Flik", "elwynn", NOW + 120_000)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);

    // Well into the visit, a fresh look is worth recording so the answer still reads as live.
    expect(await service.observeNearbyNpc("Sayge", "elwynn", NOW + 40 * 60_000)).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("outranks a troll's channel line outright", async () => {
    const service = makeService();
    await service.observeNearbyNpc("Silas Darkmoon", "elwynn", NOW);
    for (let i = 0; i < 10; i += 1) {
      await service.observeChannel("PWB_DMF:10401:M-0-Liar", `sock-${i}`, NOW);
    }
    expect(service.report(NOW).location).toBe("elwynn");
    expect(service.report(NOW).confirmedBy).toBe("onsite");
  });

  it("raises the schedule conflict loudly — we are looking straight at it", async () => {
    const onScheduleConflict = vi.fn();
    const service = makeService(new InMemoryKnowledgeStore(), { onScheduleConflict });
    expect(await service.observeNearbyNpc("Silas Darkmoon", "elwynn", AFTER)).toBe(false);
    expect(onScheduleConflict).toHaveBeenCalledWith({
      seenAt: AFTER,
      location: "elwynn",
      source: "onsite",
      witness: "Silas Darkmoon",
    });
    expect(service.knowledge.onsite).toBeNull();
  });

  it("pins the alternation for every other month, including the zone it never sees", async () => {
    // Parked in Elwynn and the faire is here in September — so October is Mulgore, forever, even
    // though this character will never lay eyes on Mulgore.
    const service = makeService();
    await service.observeNearbyNpc("Silas Darkmoon", "elwynn", NOW);
    const october = service.report(utc("2026-10-06T12:00:00Z"));
    expect(october.location).toBe("mulgore");
    expect(october.confirmedBy).toBe("onsite");
  });
});
