import { describe, expect, it } from "vitest";
import { InMemorySubscriberStore } from "./memory-store.js";

describe("InMemorySubscriberStore", () => {
  it("adds a subscriber once and reports the first add as new", async () => {
    const store = new InMemorySubscriberStore();
    expect(await store.add("Raider")).toBe(true);
    expect(await store.add("Raider")).toBe(false);
    expect(await store.all()).toHaveLength(1);
  });

  it("matches names case-insensitively but keeps the display casing", async () => {
    const store = new InMemorySubscriberStore();
    await store.add("Raider");
    expect(await store.has("raider")).toBe(true);
    expect(await store.add("RAIDER")).toBe(false);
    expect((await store.all())[0]?.name).toBe("Raider");
  });

  it("removes a subscriber and reports whether one was there", async () => {
    const store = new InMemorySubscriberStore();
    await store.add("Raider");
    expect(await store.remove("raider")).toBe(true);
    expect(await store.remove("raider")).toBe(false);
    expect(await store.has("Raider")).toBe(false);
  });

  it("ignores blank names", async () => {
    const store = new InMemorySubscriberStore();
    expect(await store.add("   ")).toBe(false);
    expect(await store.all()).toHaveLength(0);
  });

  it("defaults a new subscriber to no Discord id and 'both' delivery", async () => {
    const store = new InMemorySubscriberStore();
    await store.add("Raider");
    const sub = await store.get("raider");
    expect(sub).toMatchObject({ name: "Raider", discordId: null, delivery: "both" });
  });

  it("updates the Discord id and delivery mode, and can clear the id", async () => {
    const store = new InMemorySubscriberStore();
    await store.add("Raider");
    expect(await store.update("raider", { discordId: "123456789012345678", delivery: "offline" })).toBe(true);
    expect(await store.get("raider")).toMatchObject({ discordId: "123456789012345678", delivery: "offline" });
    await store.update("raider", { discordId: null });
    expect((await store.get("raider"))?.discordId).toBeNull();
    expect((await store.get("raider"))?.delivery).toBe("offline"); // untouched
  });

  it("defaults a new subscriber to all alert types", async () => {
    const store = new InMemorySubscriberStore();
    await store.add("Raider");
    expect((await store.get("raider"))?.alerts).toEqual(["forming", "cleared"]);
  });

  it("updates alert preferences, including turning them all off", async () => {
    const store = new InMemorySubscriberStore();
    await store.add("Raider");
    await store.update("raider", { alerts: ["cleared"] });
    expect((await store.get("raider"))?.alerts).toEqual(["cleared"]);
    await store.update("raider", { alerts: [] });
    expect((await store.get("raider"))?.alerts).toEqual([]);
    expect((await store.get("raider"))?.delivery).toBe("both"); // untouched
  });

  it("does not update a name that isn't subscribed", async () => {
    const store = new InMemorySubscriberStore();
    expect(await store.update("Ghost", { delivery: "offline" })).toBe(false);
    expect(await store.get("Ghost")).toBeNull();
  });

  it("removes every character linked to a Discord id, returning their names", async () => {
    const store = new InMemorySubscriberStore();
    await store.add("Main");
    await store.add("Alt");
    await store.add("Other");
    await store.update("main", { discordId: "42" });
    await store.update("alt", { discordId: "42" });
    await store.update("other", { discordId: "99" });
    expect((await store.findByDiscordId("42")).map((s) => s.name).sort()).toEqual(["Alt", "Main"]);
    const removed = await store.removeByDiscordId("42");
    expect(removed.sort()).toEqual(["Alt", "Main"]);
    expect(await store.has("Main")).toBe(false);
    expect(await store.has("Other")).toBe(true); // different id, untouched
    expect(await store.removeByDiscordId("nobody")).toEqual([]);
    expect(await store.findByDiscordId("42")).toEqual([]); // all gone now
    expect(await store.findByDiscordId("")).toEqual([]);
  });
});
