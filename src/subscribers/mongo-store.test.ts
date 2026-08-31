import { describe, expect, it, vi } from "vitest";
import { MongoSubscriberStore, type SubscriberDb, type SubscriberDoc } from "./mongo-store.js";

/** A fake SubscriberDb backed by a Map, honouring upsert/delete/update semantics. */
function fakeDb(): SubscriberDb & { docs: Map<string, SubscriberDoc> } {
  const docs = new Map<string, SubscriberDoc>();
  return {
    docs,
    upsertNew: vi.fn(async (doc: SubscriberDoc) => {
      if (docs.has(doc._id)) return { upsertedCount: 0 };
      docs.set(doc._id, doc);
      return { upsertedCount: 1 };
    }),
    deleteByKey: vi.fn(async (key: string) => ({ deletedCount: docs.delete(key) ? 1 : 0 })),
    countByKey: vi.fn(async (key: string) => (docs.has(key) ? 1 : 0)),
    getByKey: vi.fn(async (key: string) => docs.get(key) ?? null),
    setFields: vi.fn(async (key: string, fields) => {
      const doc = docs.get(key);
      if (!doc) return { matchedCount: 0 };
      docs.set(key, { ...doc, ...fields });
      return { matchedCount: 1 };
    }),
    list: vi.fn(async () => [...docs.values()]),
    close: vi.fn(async () => {}),
  };
}

describe("MongoSubscriberStore", () => {
  it("maps a first upsert to true and a repeat to false, with defaults", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    expect(await store.add("Raider")).toBe(true);
    expect(await store.add("raider")).toBe(false);
    expect(db.docs.get("raider")).toMatchObject({ name: "Raider", discordId: null, delivery: "both" });
  });

  it("maps a delete to whether a doc was removed", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    await store.add("Raider");
    expect(await store.remove("RAIDER")).toBe(true);
    expect(await store.remove("RAIDER")).toBe(false);
  });

  it("gets a subscriber without the internal _id", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    await store.add("Raider");
    const sub = await store.get("raider");
    expect(sub).toMatchObject({ name: "Raider", delivery: "both" });
    expect(sub).not.toHaveProperty("_id");
  });

  it("removes every character linked to a Discord id and returns their names", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    await store.add("Main");
    await store.add("Alt");
    await store.add("Other");
    await store.update("main", { discordId: "42" });
    await store.update("alt", { discordId: "42" });
    await store.update("other", { discordId: "99" });
    const removed = await store.removeByDiscordId("42");
    expect(removed.sort()).toEqual(["Alt", "Main"]);
    expect(db.docs.has("main")).toBe(false);
    expect(db.docs.has("other")).toBe(true);
    expect(await store.removeByDiscordId("nobody")).toEqual([]);
  });

  it("updates only the provided fields", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    await store.add("Raider");
    expect(await store.update("raider", { discordId: "123456789012345678" })).toBe(true);
    expect(db.setFields).toHaveBeenCalledWith("raider", { discordId: "123456789012345678" });
    expect(db.docs.get("raider")?.discordId).toBe("123456789012345678");
    expect(db.docs.get("raider")?.delivery).toBe("both");
  });

  it("returns false updating a name that isn't subscribed", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    expect(await store.update("Ghost", { delivery: "offline" })).toBe(false);
  });

  it("lists subscribers without the internal _id", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    await store.add("Raider");
    const all = await store.all();
    expect(all[0]?.name).toBe("Raider");
    expect(all[0]).not.toHaveProperty("_id");
  });

  it("closes the underlying connection", async () => {
    const db = fakeDb();
    await new MongoSubscriberStore(db).close();
    expect(db.close).toHaveBeenCalled();
  });
});
