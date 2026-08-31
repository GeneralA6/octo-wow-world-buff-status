import { describe, expect, it, vi } from "vitest";
import { InMemorySubscriberStore } from "../subscribers/memory-store.js";
import { PendingLinks } from "../subscribers/pending-links.js";
import { DiscordDmSender, type DiscordFetch, type DiscordResponse } from "../notify/discord-dm.js";
import { RaidTracker } from "../watcher/raid-tracker.js";
import type { WhoPlayer } from "../protocol/who.js";
import { DiscordLinker } from "./discord-linker.js";
import { CommandRouter } from "./command-router.js";

function res(ok: boolean, status: number, body: unknown = { id: "chan" }): DiscordResponse {
  return { ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve("") };
}

function deps(opts: { withLinker?: boolean; fetch?: DiscordFetch } = {}) {
  const store = new InMemorySubscriberStore();
  const tracker = new RaidTracker(15);
  const pending = new PendingLinks({ generate: () => "CODE01" });
  const dm = new DiscordDmSender("tok", opts.fetch ?? (() => Promise.resolve(res(true, 200))));
  const linker =
    opts.withLinker === false
      ? null
      : new DiscordLinker({ store, pending, dm, serverInviteUrl: "https://discord.gg/x", areaName: "Onyxia's Lair" });
  const router = new CommandRouter({
    store,
    activeRaids: () => tracker.activeRaids(),
    areaName: "Onyxia's Lair",
    guildName: "Rage Quit",
    community: "OctoWoW",
    linker,
  });
  return { store, tracker, pending, linker, router };
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

  it("unsubscribes a player", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "unsubscribe"))[0]).toMatch(/Unsubscribed/);
    expect(await store.has("Raider")).toBe(false);
  });

  it("reports the active raid on status", async () => {
    const { tracker, router } = deps();
    tracker.update(crowd("Nightfall", 20));
    const reply = (await router.handle("Raider", "status"))[0];
    expect(reply).toContain("<Nightfall>");
    expect(reply).toContain("20");
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

  it("notify rejects an unknown type and nudges an unsubscribed player", async () => {
    const { store, router } = deps();
    await store.add("Raider");
    expect((await router.handle("Raider", "notify bogus"))[0]).toMatch(/Unknown alert/);
    expect((await router.handle("Ghost", "notify"))[0]).toMatch(/not subscribed/);
  });

  it("flow A: 'discord' mints a code to DM and subscribes the caller", async () => {
    const { store, router } = deps();
    const reply = (await router.handle("Raider", "discord")).join(" ");
    expect(reply).toContain("CODE01"); // the DM-a-code method
    expect(reply).toContain("discord.gg/x"); // the server to join
    expect(reply).toMatch(/discord id/i); // ...AND the give-us-your-id method, both stated
    expect(await store.has("Raider")).toBe(true);
  });

  it("flow B: 'discord <id>' DMs a code and asks to confirm", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "discord 123456789012345678"))[0]).toMatch(/DMed you a code/);
  });

  it("flow B: an unreachable id guides the user to join and open DMs", async () => {
    const { router } = deps({ fetch: () => Promise.resolve(res(false, 403)) });
    const reply = (await router.handle("Raider", "discord 123456789012345678"))[0];
    expect(reply).toMatch(/couldn't DM you/);
    expect(reply).toContain("discord.gg/x");
  });

  it("confirms a flow-B code, whether via 'confirm <code>' or a bare code", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "discord 123456789012345678");
    expect((await router.handle("Raider", "confirm CODE01"))[0]).toMatch(/linked/i);
    expect((await store.get("Raider"))?.discordId).toBe("123456789012345678");

    const again = deps();
    await again.router.handle("Raider", "discord 123456789012345678");
    expect((await again.router.handle("Raider", "CODE01"))[0]).toMatch(/linked/i);
  });

  it("rejects a non-id and points at the DM flow", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "discord 42"))[0]).toMatch(/isn't a Discord id/);
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

  it("shows the caller their settings and rejects unknown commands", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "me"))[0]).toMatch(/not subscribed/);
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "me"))[0]).toMatch(/no Discord linked/);
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
