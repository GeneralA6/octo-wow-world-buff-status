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
  });
  return { store, tracker, router, feedback };
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

  it("follows a fresh subscribe with the full faction/unsubscribe hint (once, on opt-in)", async () => {
    const { router } = deps();
    const reply = await router.handle("Raider", "subscribe");
    const hint = reply.find((l) => /alliance/i.test(l)) ?? "";
    expect(hint).toMatch(/alliance.*horde|horde.*alliance/i);
    expect(hint).toMatch(/unsubscribe/i);
    // A repeat subscribe does NOT re-send the hint.
    const again = await router.handle("Raider", "subscribe");
    expect(again.some((l) => /alliance/i.test(l))).toBe(false);
  });

  it("unsubscribes a player", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "unsubscribe"))[0]).toMatch(/Unsubscribed/);
    expect(await store.has("Raider")).toBe(false);
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
    const reply = await router.handle("Raider", "status");
    expect(reply[0]).toMatch(/raid #834.*in for ~42m/);
    expect(reply[0]).not.toMatch(/\b20\b/); // player count is redundant to a user — omitted
    expect(reply[1]).toContain("Stormwind: a fresh buff can drop now");
    expect(reply[1]).toMatch(/Orgrimmar: buff up, ~1h12m/);
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
    expect(reply[1]).toContain("a fresh buff can drop now");
  });

  it("understands natural phrasing: 'sign me up' subscribes", async () => {
    const { store, router } = deps();
    const reply = (await router.handle("Raider", "hey can you sign me up"))[0];
    expect(reply).toMatch(/subscribed/i);
    expect(await store.has("Raider")).toBe(true);
  });

  it("understands a guild question and pitches recruiting", async () => {
    const { router } = deps();
    const reply = (await router.handle("Raider", "how do I join?"))[0];
    expect(reply).toContain("Rage Quit");
    expect(reply).toMatch(/recruit/i);
  });

  it("sends a guild invite on 'invite' when the capability is wired, else says it can't", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "invite"))[0]).toMatch(/can't send a guild invite/i);
    const invited: string[] = [];
    router.setGuildInvite((name) => invited.push(name));
    const reply = (await router.handle("Raider", "invite"))[0];
    expect(invited).toEqual(["Raider"]);
    expect(reply).toContain("Rage Quit");
    router.setGuildInvite(null);
    expect((await router.handle("Raider", "invite"))[0]).toMatch(/can't send a guild invite/i);
  });

  it("answers a buff question with a subscribe nudge", async () => {
    const { router } = deps();
    const reply = (await router.handle("Raider", "when's the buff coming?"))[0];
    expect(reply).toMatch(/Rallying Cry/i);
    expect(reply).toMatch(/subscribe/i);
  });

  it("falls back gracefully on true gibberish", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "qwzx blorp"))[0]).toMatch(/didn't get that/i);
  });

  it("no longer has a 'notify' command — alert-type choosing is gone", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "notify forming off"))[0]).toMatch(/didn't get that/i);
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
    expect(reply).toMatch(/OctoWoW/);
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

  it("the faction command needs a subscription and rejects gibberish", async () => {
    const { router } = deps();
    expect((await router.handle("Ghost", "alliance"))[0]).toMatch(/not subscribed/i);
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "faction wat"))[0]).toMatch(/alliance.*horde.*both/i);
  });

  it("shows the caller their settings via 'profile' (and the 'me' alias), rejects unknown commands", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "profile"))[0]).toMatch(/not subscribed/);
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "profile"))[0]).toMatch(/Subscribed - .*change your side/);
    expect((await router.handle("Raider", "me"))[0]).toMatch(/Subscribed -/); // alias still works
    expect((await router.handle("Raider", "flibber"))[0]).toMatch(/didn't get that/);
  });

  it("help leads with subscribe and covers side, invite, feedback and discord — but not notify", async () => {
    const { router } = deps();
    const help = (await router.handle("Raider", "help")).join(" ");
    expect(help).toMatch(/subscribe/i);
    expect(help).toMatch(/alliance/i);
    expect(help).toMatch(/feedback/i);
    expect(help).toMatch(/discord/i);
    expect(help).not.toMatch(/notify/i);
  });
});
