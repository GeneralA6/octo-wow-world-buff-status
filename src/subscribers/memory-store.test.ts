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
});
