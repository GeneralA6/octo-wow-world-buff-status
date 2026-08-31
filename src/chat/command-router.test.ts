import { describe, expect, it, vi } from "vitest";
import { InMemorySubscriberStore } from "../subscribers/memory-store.js";
import { PendingLinks } from "../subscribers/pending-links.js";
import { DiscordDmSender, type DiscordFetch, type DiscordResponse } from "../notify/discord-dm.js";
import { RaidTracker } from "../watcher/raid-tracker.js";
import type { WhoPlayer } from "../protocol/who.js";
import { DiscordLinker } from "./discord-linker.js";
import { CommandRouter, type BuffCooldown } from "./command-router.js";

function res(ok: boolean, status: number, body: unknown = { id: "chan" }): DiscordResponse {
  return { ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve("") };
}

function deps(
  opts: {
    withLinker?: boolean;
    fetch?: DiscordFetch;
    mintInvite?: (character: string) => Promise<string | null>;
    withFeedback?: boolean;
    raidElapsed?: () => number | null;
    raidNumber?: () => number | null;
    buffCooldowns?: () => Promise<readonly BuffCooldown[]>;
  } = {},
) {
  const store = new InMemorySubscriberStore();
  const tracker = new RaidTracker(15);
  const pending = new PendingLinks({ generate: () => "CODE01" });
  const dm = new DiscordDmSender("tok", opts.fetch ?? (() => Promise.resolve(res(true, 200))));
  const linker =
    opts.withLinker === false
      ? null
      : new DiscordLinker({ store, pending, dm, serverInviteUrl: "https://discord.gg/x", areaName: "Onyxia's Lair" });
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
    linker,
    mintInvite: opts.mintInvite,
    onFeedback: opts.withFeedback === false ? undefined : (from, text) => feedback.push({ from, text }),
  });
  return { store, tracker, pending, linker, router, feedback };
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

  describe("handleFromDiscord", () => {
    async function withLinkedChar() {
      const d = deps();
      await d.store.add("Raider");
      await d.store.update("raider", { discordId: "42" });
      return d;
    }

    it("routes a command to the account's linked character", async () => {
      const { store, router } = await withLinkedChar();
      const reply = await router.handleFromDiscord("42", "alliance");
      expect(reply[0]).toMatch(/Stormwind/i);
      expect((await store.get("raider"))?.factions).toEqual(["alliance"]); // it actually changed
    });

    it("feedback from Discord is attributed to the linked character", async () => {
      const { router, feedback } = await withLinkedChar();
      await router.handleFromDiscord("42", "feedback the timer is off");
      expect(feedback[0]).toEqual({ from: "Raider", text: "the timer is off" });
    });

    it("guides an unlinked account to link first", async () => {
      const { router } = deps();
      expect((await router.handleFromDiscord("999", "profile"))[0]).toMatch(/not linked/i);
    });

    it("still gives help to an unlinked account", async () => {
      const { router } = deps();
      expect((await router.handleFromDiscord("999", "help")).join(" ")).toMatch(/subscribe/i);
    });

    it("unsubscribe from Discord stops every character on the account", async () => {
      const { store, router } = deps();
      await store.add("Main");
      await store.update("main", { discordId: "42" });
      await store.add("Alt");
      await store.update("alt", { discordId: "42" });
      expect((await router.handleFromDiscord("42", "unsubscribe"))[0]).toMatch(/Unsubscribed/);
      expect(await store.has("Main")).toBe(false);
      expect(await store.has("Alt")).toBe(false);
    });
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

  it("notify: shows all alert types by default", async () => {
    const { store, router } = deps();
    await store.add("Raider");
    const reply = (await router.handle("Raider", "notify"))[0];
    expect(reply).toContain("forming, cleared");
  });

  it("notify <type> off/on toggles that alert", async () => {
    const { store, router } = deps();
    await store.add("Raider");
    await router.handle("Raider", "notify forming off");
    expect((await store.get("Raider"))?.alerts).toEqual(["cleared"]);
    await router.handle("Raider", "notify forming on");
    expect((await store.get("Raider"))?.alerts).toEqual(["forming", "cleared"]);
  });

  it("notify <type> with no on/off flips it", async () => {
    const { store, router } = deps();
    await store.add("Raider");
    await router.handle("Raider", "notify cleared");
    expect((await store.get("Raider"))?.alerts).toEqual(["forming"]);
  });

  it("notify all / none set every alert", async () => {
    const { store, router } = deps();
    await store.add("Raider");
    await router.handle("Raider", "notify none");
    expect((await store.get("Raider"))?.alerts).toEqual([]);
    await router.handle("Raider", "notify all");
    expect((await store.get("Raider"))?.alerts).toEqual(["forming", "cleared"]);
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

  it("notify rejects an unknown type and nudges an unsubscribed player", async () => {
    const { store, router } = deps();
    await store.add("Raider");
    expect((await router.handle("Raider", "notify bogus"))[0]).toMatch(/Unknown alert/);
    expect((await router.handle("Ghost", "notify"))[0]).toMatch(/not subscribed/);
  });

  it("'discord' offers /link and the Discord-ID path", async () => {
    const { router } = deps();
    const reply = (await router.handle("Raider", "discord")).join(" ");
    expect(reply).toMatch(/\/link Raider/); // slash command, prefilled with their name
    expect(reply).toContain("discord.gg/x"); // where to join
    expect(reply).toMatch(/discord id/i); // the in-WoW ID path
  });

  it("discord adds the one-click personal invite when personal-invite linking is on", async () => {
    const { router } = deps({ mintInvite: async (character) => `https://discord.gg/for-${character}` });
    const reply = (await router.handle("Raider", "discord")).join(" ");
    expect(reply).toContain("https://discord.gg/for-Raider"); // the personal invite
    expect(reply).toMatch(/\/link Raider/); // still leads with /link
  });

  it("discord still works (no personal invite line) when minting isn't available", async () => {
    const { router } = deps({ mintInvite: async () => null });
    const reply = (await router.handle("Raider", "discord")).join(" ");
    expect(reply).toMatch(/\/link Raider/);
    expect(reply).not.toContain("discord.gg/for-"); // no personal-invite line
  });

  it("'discord <id>' DMs a code (flow B), and a whispered code back confirms", async () => {
    const { store, router } = deps();
    expect((await router.handle("Raider", "discord 123456789012345678"))[0]).toMatch(/DMed you a code/);
    expect((await router.handle("Raider", "CODE01"))[0]).toMatch(/linked/i);
    expect((await store.get("Raider"))?.discordId).toBe("123456789012345678");
  });

  it("'discord <not-an-id>' explains how to get the numeric id", async () => {
    const { router } = deps();
    const reply = (await router.handle("Raider", "discord General_A6#6266")).join(" ");
    expect(reply).toContain("General_A6#6266"); // echoes what they sent
    expect(reply).toMatch(/not your username/i); // it's an id, not the username
    expect(reply).toMatch(/copy user id/i); // ...and how to get it
  });

  it("'discord off' unlinks", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    await store.update("Raider", { discordId: "999888777" });
    expect((await router.handle("Raider", "discord off"))[0]).toMatch(/unlinked/i);
    expect((await store.get("Raider"))?.discordId).toBeNull();
  });

  it("unlinks with 'discord off'", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "discord 123456789012345678");
    await router.handle("Raider", "CODE01");
    expect((await router.handle("Raider", "discord off"))[0]).toMatch(/unlinked/);
    expect((await store.get("Raider"))?.discordId).toBeNull();
  });

  it("says so when Discord isn't configured", async () => {
    const { router } = deps({ withLinker: false });
    expect((await router.handle("Raider", "discord"))[0]).toMatch(/isn't set up/);
  });

  it("sets the delivery mode and warns when offline has no Discord link", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "mode offline"))[0]).toMatch(/link Discord/);
    expect((await store.get("Raider"))?.delivery).toBe("offline");
  });

  it("mode ingame sets whispers-only with no Discord warning", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    const reply = (await router.handle("Raider", "mode ingame"))[0];
    expect(reply).toMatch(/whispers only/);
    expect(reply).not.toMatch(/link Discord/);
    expect((await store.get("Raider"))?.delivery).toBe("ingame");
  });

  it("mode discord warns hard when no Discord is linked", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    const reply = (await router.handle("Raider", "mode discord"))[0];
    expect(reply).toMatch(/NO Discord linked/);
    expect((await store.get("Raider"))?.delivery).toBe("discord");
  });

  it("shows the caller their settings via 'profile' (and the 'me' alias), rejects unknown commands", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "profile"))[0]).toMatch(/not subscribed/);
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "profile"))[0]).toMatch(/no Discord linked/);
    expect((await router.handle("Raider", "me"))[0]).toMatch(/no Discord linked/); // alias still works
    expect((await router.handle("Raider", "flibber"))[0]).toMatch(/didn't get that/);
  });

  it("help leads with subscribe and surfaces the offline-Discord feature", async () => {
    const { router } = deps();
    const help = (await router.handle("Raider", "help")).join(" ");
    expect(help).toMatch(/subscribe/i);
    expect(help).toMatch(/offline/i);
    expect(help).toMatch(/discord/i);
  });
});
