import { describe, expect, it } from "vitest";
import { InMemorySubscriberStore } from "../subscribers/memory-store.js";
import { RaidTracker } from "../watcher/raid-tracker.js";
import type { WhoPlayer } from "../protocol/who.js";
import { CommandRouter } from "./command-router.js";

function deps() {
  const store = new InMemorySubscriberStore();
  const tracker = new RaidTracker(15);
  const router = new CommandRouter({ store, tracker, areaName: "Onyxia's Lair" });
  return { store, tracker, router };
}

function crowd(guild: string, count: number): WhoPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${guild}${i}`, guild, level: 60, classId: 1, raceId: 1, areaId: 2159,
  }));
}

describe("CommandRouter", () => {
  it("subscribes a player and is idempotent", async () => {
    const { store, router } = deps();
    expect((await router.handle("Raider", "subscribe"))[0]).toMatch(/Subscribed/);
    expect(await store.has("Raider")).toBe(true);
    expect((await router.handle("Raider", "subscribe"))[0]).toMatch(/already subscribed/);
  });

  it("unsubscribes a player", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "subscribe");
    expect((await router.handle("Raider", "unsubscribe"))[0]).toMatch(/Unsubscribed/);
    expect(await store.has("Raider")).toBe(false);
  });

  it("tolerates aliases and a leading slash or bang", async () => {
    const { store, router } = deps();
    await router.handle("Raider", "/sub");
    expect(await store.has("Raider")).toBe(true);
    await router.handle("Raider", "!stop");
    expect(await store.has("Raider")).toBe(false);
  });

  it("reports no raid when the lair is quiet", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "status"))[0]).toMatch(/No raid/);
  });

  it("reports the active raid on status", async () => {
    const { tracker, router } = deps();
    tracker.update(crowd("Nightfall", 20));
    const reply = (await router.handle("Raider", "status"))[0];
    expect(reply).toContain("<Nightfall>");
    expect(reply).toContain("20");
  });

  it("answers help and rejects unknown commands", async () => {
    const { router } = deps();
    expect((await router.handle("Raider", "help"))[0]).toMatch(/Commands:/);
    expect((await router.handle("Raider", "flibber"))[0]).toMatch(/Unknown command/);
  });
});
