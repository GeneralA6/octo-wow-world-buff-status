import { describe, expect, it, vi } from "vitest";
import { InMemoryShameListStore, MongoShameListStore, type ShameListDb } from "./shame-list-store.js";

describe("InMemoryShameListStore", () => {
  it("starts empty and returns what was saved", async () => {
    const store = new InMemoryShameListStore();
    expect(await store.load()).toEqual([]);
    await store.save(["Ganker"]);
    expect(await store.load()).toEqual(["Ganker"]);
  });
});

describe("MongoShameListStore", () => {
  const fakeDb = () => {
    let held: readonly string[] = [];
    const db = {
      get: vi.fn(async () => held),
      set: vi.fn(async (names: readonly string[]) => {
        held = names;
      }),
      close: vi.fn(async () => undefined),
    } satisfies ShameListDb;
    return db;
  };

  it("round-trips the players through the collection", async () => {
    const db = fakeDb();
    const store = new MongoShameListStore(db);
    expect(await store.load()).toEqual([]);
    await store.save(["Ganker", "Warlockz"]);
    expect(db.set).toHaveBeenCalledWith(["Ganker", "Warlockz"]);
    expect(await store.load()).toEqual(["Ganker", "Warlockz"]);
  });

  it("releases the client on close", async () => {
    const db = fakeDb();
    await new MongoShameListStore(db).close();
    expect(db.close).toHaveBeenCalledTimes(1);
  });
});
