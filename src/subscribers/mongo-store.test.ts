import { describe, expect, it, vi } from "vitest";
import { MongoSubscriberStore, type SubscriberDb, type SubscriberDoc } from "./mongo-store.js";

/** A fake SubscriberDb backed by a Map, honouring upsert/delete semantics. */
function fakeDb(): SubscriberDb & { docs: Map<string, SubscriberDoc> } {
  const docs = new Map<string, SubscriberDoc>();
  return {
    docs,
    upsertNew: vi.fn(async (key: string, name: string, subscribedAt: Date) => {
      if (docs.has(key)) return { upsertedCount: 0 };
      docs.set(key, { _id: key, name, subscribedAt });
      return { upsertedCount: 1 };
    }),
    deleteByKey: vi.fn(async (key: string) => ({ deletedCount: docs.delete(key) ? 1 : 0 })),
    countByKey: vi.fn(async (key: string) => (docs.has(key) ? 1 : 0)),
    list: vi.fn(async () => [...docs.values()]),
    close: vi.fn(async () => {}),
  };
}

describe("MongoSubscriberStore", () => {
  it("maps a first upsert to true and a repeat to false", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    expect(await store.add("Raider")).toBe(true);
    expect(await store.add("raider")).toBe(false); // same canonical key
    expect(db.upsertNew).toHaveBeenCalledWith("raider", "Raider", expect.any(Date));
  });

  it("maps a delete to whether a doc was removed", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    await store.add("Raider");
    expect(await store.remove("RAIDER")).toBe(true);
    expect(await store.remove("RAIDER")).toBe(false);
  });

  it("reports presence via the key count", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    await store.add("Raider");
    expect(await store.has("raider")).toBe(true);
    expect(await store.has("Someone")).toBe(false);
  });

  it("lists subscribers without the internal _id", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    await store.add("Raider");
    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("Raider");
    expect(all[0]).not.toHaveProperty("_id");
  });

  it("ignores blank names without touching the db", async () => {
    const db = fakeDb();
    const store = new MongoSubscriberStore(db);
    expect(await store.add("  ")).toBe(false);
    expect(db.upsertNew).not.toHaveBeenCalled();
  });

  it("closes the underlying connection", async () => {
    const db = fakeDb();
    await new MongoSubscriberStore(db).close();
    expect(db.close).toHaveBeenCalled();
  });
});
