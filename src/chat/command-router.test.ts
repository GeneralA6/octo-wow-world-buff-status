import { describe, expect, it } from "vitest";
import { InMemorySubscriberStore } from "../subscribers/memory-store.js";
import { RaidTracker } from "../watcher/raid-tracker.js";
import type { WhoPlayer } from "../protocol/who.js";
import { CommandRouter, type BuffCooldown } from "./command-router.js";

function deps(
  opts: {
    withFeedback?: boolean;
    raidElapsed?: () => number | null;
    raidNumber?: () => number | null;
    buffCooldowns?: () => Promise<readonly BuffCooldown[]>;
  } = {},
) {
  const store = new InMemorySubscriberStore();
  const tracker = new RaidTracker(15);
  const feedback: { from: string; text: string }[] = [];
  const subscribed: string[] = [];
  const router = new CommandRouter({
    store,
    activeRaids: () => tracker.activeRaids(),
    raidElapsed: opts.raidElapsed,
    raidNumber: opts.raidNumber,
    buffCooldowns: opts.buffCooldowns,
    areaName: "Onyxia's Lair",
    guildName: "Rage Quit",
    community: "OctoWoW",
    onFeedback: opts.withFeedback === false ? undefined : (from, text) => feedback.push({ from, text }),
    onSubscribe: (name) => subscribed.push(name),
  });
  return { store, tracker, router, feedback, subscribed };
}

function crowd(guild: string, count: number): WhoPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${guild}${i}`, guild, level: 60, classId: 1, raceId: 1, areaId: 2159,
  }));
}

describe("CommandRouter", () => {
  it("subscribes a player and is idempotent", async () => {
    const { store, router } = deps();
    expect((await router.handle("Raider", "subscribe"))[0]).toMatch(/subscribed/i);
    expect(await store.has("Raider")).toBe(true);
    expect((await router.handle("Raider", "subscribe"))[0]).toMatch(/already subscribed/);
  });

  it("confirms a fresh subscribe in one line, without pushing manual faction selection", async () => {
    const { router } = deps();
    const reply = await router.handle("Raider", "subscribe");
    expect(reply).toHaveLength(1); // just the confirmation — the side is auto-detected in the background
    expect(reply[0]).toMatch(/subscribed/i);
    expect(reply[0]).not.toMatch(/alliance|horde|both/i);
  });

  it("unsubscribes a player", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "unsubscribe"))[0]).toMatch(/Unsubscribed/);
    expect(await store.has("Raider")).toBe(false);
  });

  it("fires onSubscribe once for a fresh subscribe (for the lifetime ledger), not on a repeat", async () => {
    const { router, subscribed } = deps();
    await router.handle("Raider", "subscribe");
    await router.handle("Raider", "subscribe"); // already subscribed → no second record
    expect(subscribed).toEqual(["Raider"]);
  });

  it("captures feedback with the sender's name and thanks them", async () => {
    const { router, feedback } = deps();
    const reply = await router.handle("Raider", "feedback the timer felt 5 min late");
    expect(feedback).toEqual([{ from: "Raider", text: "the timer felt 5 min late" }]);
    expect(reply[0]).toMatch(/thanks/i);
  });

  it("accepts 'suggest' as an alias and does not require a subscription", async () => {
    const { store, router, feedback } = deps();
    await router.handle("Raider", "suggest add a horde-only mode");
    expect(await store.has("Raider")).toBe(false); // no subscription needed
    expect(feedback[0]).toEqual({ from: "Raider", text: "add a horde-only mode" });
  });

  it("shows usage and captures nothing when feedback has no message", async () => {
    const { router, feedback } = deps();
    const reply = await router.handle("Raider", "feedback");
    expect(feedback).toEqual([]);
    expect(reply[0]).toMatch(/feedback <your message>/i);
  });

  it("tells the player when feedback isn't wired up", async () => {
    const { router } = deps({ withFeedback: false });
    const reply = await router.handle("Raider", "feedback hi");
    expect(reply[0]).toMatch(/isn't set up/i);
  });

  it("reports the raid #, how long it's been in, and the buff cooldown on status", async () => {
    const { tracker, router } = deps({
      raidElapsed: () => 42 * 60_000,
      raidNumber: () => 834,
      buffCooldowns: async () => [
        { faction: "alliance", activeMsLeft: null }, // ready now
        { faction: "horde", activeMsLeft: 72 * 60_000 }, // up, 1h12m left
      ],
    });
    tracker.update(crowd("Nightfall", 20));
    // "Raider" isn't subscribed and no /who detect is wired here, so both capitals show.
    const reply = await router.handle("Raider", "status");
    expect(reply[0]).toMatch(/raid #834.*in for ~42m/);
    expect(reply[0]).not.toMatch(/\b20\b/); // player count is redundant to a user — omitted
    expect(reply[1]).toContain("Stormwind: off cooldown");
    expect(reply[1]).not.toMatch(/drop now/); // no imminent CTA — a raid must still clear
    expect(reply[1]).toMatch(/Orgrimmar: buff on cooldown, ~1h12m/); // "on cooldown", not "up"
  });

  it("shows only the subscriber's own side's cooldown, not both", async () => {
    const { store, router } = deps({
      buffCooldowns: async () => [
        { faction: "alliance", activeMsLeft: null },
        { faction: "horde", activeMsLeft: 72 * 60_000 },
      ],
    });
    await store.add("Raider");
    await store.update("Raider", { factions: ["horde"] }); // subscribed on the horde side
    const reply = (await router.handle("Raider", "status")).join(" ");
    expect(reply).toMatch(/Orgrimmar: buff on cooldown/); // their capital
    expect(reply).not.toMatch(/Stormwind/); // never the other side
  });

  it("detects a non-subscriber's side via /who and shows only that capital", async () => {
    const { router } = deps({
      buffCooldowns: async () => [
        { faction: "alliance", activeMsLeft: null },
        { faction: "horde", activeMsLeft: 72 * 60_000 },
      ],
    });
    router.setFactionDetect(async () => "alliance"); // /who resolves them to alliance
    const reply = (await router.handle("Ghost", "status")).join(" ");
    expect(reply).toMatch(/Stormwind: off cooldown/);
    expect(reply).not.toMatch(/Orgrimmar/);
  });

  it("subscribe via a listener sets the side from the hint, with NO /who lookup", async () => {
    const { store, router } = deps();
    let lookups = 0;
    router.setFactionLookup(() => (lookups += 1));
    await router.handle("Raider", "subscribe", "horde"); // came through the horde listener
    expect((await store.get("Raider"))?.factions).toEqual(["horde"]);
    expect(lookups).toBe(0); // the certain hint made the /who unnecessary
  });

  it("subscribe with no hint (a direct whisper) still falls back to the /who lookup", async () => {
    const { router } = deps();
    const looked: string[] = [];
    router.setFactionLookup((name) => looked.push(name));
    await router.handle("Raider", "subscribe"); // no source faction
    expect(looked).toEqual(["Raider"]);
  });

  it("a natural-language subscribe through a listener also uses the hint, no /who", async () => {
    const { store, router } = deps();
    let lookups = 0;
    router.setFactionLookup(() => (lookups += 1));
    await router.handle("Raider", "hey sign me up", "alliance");
    expect((await store.get("Raider"))?.factions).toEqual(["alliance"]);
    expect(lookups).toBe(0);
  });

  it("status for a non-subscriber uses the listener hint instead of a /who", async () => {
    const { router } = deps({
      buffCooldowns: async () => [
        { faction: "alliance", activeMsLeft: null },
        { faction: "horde", activeMsLeft: 72 * 60_000 },
      ],
    });
    let detects = 0;
    router.setFactionDetect(async () => {
      detects += 1;
      return "alliance";
    });
    const reply = (await router.handle("Ghost", "status", "horde")).join(" ");
    expect(reply).toMatch(/Orgrimmar/); // the hinted side
    expect(reply).not.toMatch(/Stormwind/);
    expect(detects).toBe(0); // hint used, the /who was skipped
  });

  it("status without a raid still reports the buff cooldowns", async () => {
    const { router } = deps({
      buffCooldowns: async () => [
        { faction: "alliance", activeMsLeft: null },
        { faction: "horde", activeMsLeft: null },
      ],
    });
    const reply = await router.handle("Raider", "status");
    expect(reply[0]).toMatch(/No raid in Onyxia's Lair/);
    // Off cooldown with no raid in: state a raid must still clear, never "drop now" (the next
    // raid could be many hours away, so an imminent CTA would be misleading).
    expect(reply[1]).toContain("off cooldown");
    expect(reply[1]).toContain("once a raid clears Onyxia");
    expect(reply[1]).not.toMatch(/drop now/);
  });

  it("understands natural phrasing: 'sign me up' subscribes", async () => {
    const { store, router } = deps();
    const reply = (await router.handle("Raider", "hey can you sign me up"))[0];
    expect(reply).toMatch(/subscribed/i);
    expect(await store.has("Raider")).toBe(true);
  });

  it("answers a guild question with a plain invite offer — no guild name, no recruiting pitch", async () => {
    const { router } = deps();
    const reply = (await router.handle("Raider", "how do I join?"))[0];
    expect(reply).toMatch(/invite/i); // offers the guild-invite command
    expect(reply).toMatch(/subscribe/i); // and buff alerts
    expect(reply).not.toMatch(/Rage Quit|recruit/i); // guild attribution removed
  });

  it("guild-invites SILENTLY on 'invite' when wired (no confirmation), else says it can't", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "invite"))[0]).toMatch(/can't send a guild invite/i);
    const invited: string[] = [];
    router.setGuildInvite((name) => invited.push(name));
    const reply = await router.handle("Raider", "invite");
    expect(invited).toEqual(["Raider"]); // invited
    expect(reply).toEqual([]); // and NOT told "I sent you" — welcome happens in /g on join
    router.setGuildInvite(null);
    expect((await router.handle("Raider", "invite"))[0]).toMatch(/can't send a guild invite/i);
  });

  it("answers a buff question with a subscribe nudge", async () => {
    const { router } = deps();
    const reply = (await router.handle("Raider", "when's the buff coming?"))[0];
    expect(reply).toMatch(/Rallying Cry/i);
    expect(reply).toMatch(/subscribe/i);
  });

  it("answers gibberish with the live status and a help pointer, not a dead end", async () => {
    const { router } = deps();
    const reply = (await router.handle("Raider", "qwzx blorp")).join(" ");
    expect(reply).not.toMatch(/didn't get that/i);
    expect(reply).toMatch(/No raid in Onyxia's Lair/); // the live status
    expect(reply).toMatch(/"help"/); // and a pointer to help
  });

  it("routes a natural-language suggestion to feedback, keeping the whole message", async () => {
    const { router, feedback } = deps();
    const reply = await router.handle("Raider", "you should add a horde-only mode");
    expect(feedback[0]).toEqual({ from: "Raider", text: "you should add a horde-only mode" });
    expect(reply[0]).toMatch(/thanks/i);
  });

  it("answers a natural-language Discord question by sharing the invite (when set)", async () => {
    const withInvite = new CommandRouter({
      store: new InMemorySubscriberStore(),
      activeRaids: () => [],
      areaName: "Onyxia's Lair",
      guildName: "Rage Quit",
      community: "OctoWoW",
      discordInvite: "https://discord.gg/abc",
    });
    expect((await withInvite.handle("Raider", "whats your discord?")).join(" ")).toContain("https://discord.gg/abc");
  });

  it("acknowledges a thank-you warmly", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "thanks so much!"))[0]).toMatch(/welcome/i);
  });

  it("no longer has a 'notify' command — it falls through to the status/help fallback", async () => {
    const { router } = deps();
    const reply = (await router.handle("Raider", "notify forming off")).join(" ");
    expect(reply).toMatch(/"help" for more/);
    expect(reply).not.toMatch(/alert/i); // not handled as an alert-type command
  });

  it("shares the Discord invite link on 'discord', or says it's not set", async () => {
    const withInvite = new CommandRouter({
      store: new InMemorySubscriberStore(),
      activeRaids: () => [],
      areaName: "Onyxia's Lair",
      guildName: "Rage Quit",
      community: "OctoWoW",
      discordInvite: "https://discord.gg/abc",
    });
    const reply = (await withInvite.handle("Raider", "discord")).join(" ");
    expect(reply).toContain("https://discord.gg/abc");
    expect(reply).toMatch(/outside the game/i); // says what Discord is for
    expect(reply).not.toMatch(/home of|Rage Quit/i); // no guild attribution
    // No invite configured → it says so, and never the old linking/ID flow.
    const bare = (await deps().router.handle("Raider", "discord")).join(" ");
    expect(bare).toMatch(/don't have a Discord invite/i);
    expect(bare).not.toMatch(/\/link|user id|whisper.*code/i);
  });

  it("sets the subscriber's side with alliance / horde / both", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    expect((await store.get("Raider"))?.factions).toEqual(["alliance", "horde"]); // default both
    expect((await router.handle("Raider", "horde"))[0]).toMatch(/Orgrimmar/i);
    expect((await store.get("Raider"))?.factions).toEqual(["horde"]);
    expect((await router.handle("Raider", "alliance"))[0]).toMatch(/Stormwind/i);
    expect((await store.get("Raider"))?.factions).toEqual(["alliance"]);
    expect((await router.handle("Raider", "both"))[0]).toMatch(/both/i);
    expect((await store.get("Raider"))?.factions).toEqual(["alliance", "horde"]);
  });

  it("the side words still work as an override but need a subscription", async () => {
    const { router } = deps();
    expect((await router.handle("Ghost", "alliance"))[0]).toMatch(/not subscribed/i);
  });

  it("has dropped 'profile' and 'faction' — they fall through to the status/help fallback", async () => {
    const { router } = deps();
    await router.handle("Raider", "subscribe");
    for (const msg of ["profile", "faction", "flibber"]) {
      const reply = (await router.handle("Raider", msg)).join(" ");
      expect(reply).toMatch(/"help" for more/); // the fallback pointer
      expect(reply).not.toMatch(/Subscribed|change your side/); // not a profile reply
    }
  });

  it("help is concise: status first, invite last, one command per line, no profile/faction/notify", async () => {
    const { router } = deps();
    const lines = await router.handle("Raider", "help");
    expect(lines[0]).toMatch(/^status/i); // status first
    expect(lines[lines.length - 1]).toMatch(/invite/i); // guild invite last
    const help = lines.join(" ");
    expect(help).toMatch(/subscribe \/ unsubscribe/);
    expect(help).toMatch(/discord/i);
    expect(help).toMatch(/feedback/i);
    expect(help).not.toMatch(/profile|notify|\bfaction\b|alliance/i);
  });
});
