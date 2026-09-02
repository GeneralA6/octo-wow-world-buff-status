import { describe, expect, it, vi } from "vitest";
import { InMemoryBuffStore, MongoBuffStore, type BuffDb, type BuffDrop, type Faction } from "./buff-store.js";

const at = (sec: number): Date => new Date(sec * 1000);
const drop = (faction: Faction, sec: number): BuffDrop => ({ faction, appliedAt: at(sec) });

describe("InMemoryBuffStore", () => {
  it("returns null for a faction that never dropped a buff", async () => {
    const store = new InMemoryBuffStore();
    expect(await store.current("alliance")).toBeNull();
  });

  it("returns the most recent drop as the current one, even out of order", async () => {
    const store = new InMemoryBuffStore();
    await store.record(drop("alliance", 100));
    await store.record(drop("alliance", 300)); // later
    await store.record(drop("alliance", 200)); // out of order
    const current = await store.current("alliance");
    expect(current?.appliedAt).toEqual(at(300));
    expect(current?.faction).toBe("alliance");
  });

  it("keeps factions independent", async () => {
    const store = new InMemoryBuffStore();
    await store.record(drop("alliance", 100));
    expect(await store.current("horde")).toBeNull();
    expect((await store.current("alliance"))?.faction).toBe("alliance");
  });

  it("returns per-faction history in chronological order, bounded by limit", async () => {
    const store = new InMemoryBuffStore();
    await store.record(drop("alliance", 300));
    await store.record(drop("alliance", 100));
    await store.record(drop("horde", 150));
    await store.record(drop("alliance", 200));
    const recent = await store.history("alliance", 2);
    expect(recent.map((d) => d.appliedAt.getTime() / 1000)).toEqual([200, 300]);
  });
});

describe("MongoBuffStore", () => {
  function fakeDb(): BuffDb & { docs: BuffDrop[] } {
    const docs: BuffDrop[] = [];
    return {
      docs,
      insert: vi.fn(async (doc) => {
        docs.push({ faction: doc.faction, appliedAt: doc.appliedAt });
      }),
      latest: vi.fn(async (faction: Faction, limit: number) =>
        docs
          .filter((d) => d.faction === faction)
          .sort((a, b) => b.appliedAt.getTime() - a.appliedAt.getTime())
          .slice(0, limit)
          .map((d) => ({ faction: d.faction, appliedAt: d.appliedAt })),
      ),
      close: vi.fn(async () => {}),
    };
  }

  it("records drops and reads back the latest as current", async () => {
    const db = fakeDb();
    const store = new MongoBuffStore(db);
    await store.record(drop("horde", 100));
    await store.record(drop("horde", 250));
    expect((await store.current("horde"))?.appliedAt).toEqual(at(250));
    expect(await store.current("alliance")).toBeNull();
  });

  it("returns history ascending (chronological) for measuring the real interval", async () => {
    const db = fakeDb();
    const store = new MongoBuffStore(db);
    await store.record(drop("alliance", 300));
    await store.record(drop("alliance", 100));
    await store.record(drop("alliance", 200));
    const recent = await store.history("alliance", 3);
    expect(recent.map((d) => d.appliedAt.getTime() / 1000)).toEqual([100, 200, 300]);
  });

  it("closes the underlying connection", async () => {
    const db = fakeDb();
    await new MongoBuffStore(db).close();
    expect(db.close).toHaveBeenCalled();
  });
});
