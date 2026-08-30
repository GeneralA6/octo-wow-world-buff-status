import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BUFF_DURATION_MS,
  InMemoryBuffStore,
  MongoBuffStore,
  type BuffDb,
  type BuffDrop,
  type Faction,
} from "./buff-store.js";

const at = (sec: number): Date => new Date(sec * 1000);
const drop = (faction: Faction, sec: number): BuffDrop => ({ faction, appliedAt: at(sec) });

describe("InMemoryBuffStore", () => {
  it("returns null for a faction that never dropped a buff", async () => {
    const store = new InMemoryBuffStore();
    expect(await store.current("alliance", at(100))).toBeNull();
  });

  it("computes expiry as appliedAt + duration and reports active before it", async () => {
    const store = new InMemoryBuffStore(1000); // 1s window for arithmetic clarity
    await store.record(drop("alliance", 100));
    const state = await store.current("alliance", at(100.5));
    expect(state?.appliedAt).toEqual(at(100));
    expect(state?.expiresAt).toEqual(new Date(100 * 1000 + 1000));
    expect(state?.active).toBe(true);
  });

  it("reports inactive once now is at or past expiry", async () => {
    const store = new InMemoryBuffStore(1000);
    await store.record(drop("horde", 100));
    expect((await store.current("horde", at(101)))?.active).toBe(false); // exactly at expiry
    expect((await store.current("horde", at(200)))?.active).toBe(false);
  });

  it("keeps factions independent", async () => {
    const store = new InMemoryBuffStore();
    await store.record(drop("alliance", 100));
    expect(await store.current("horde", at(100))).toBeNull();
    expect((await store.current("alliance", at(100)))?.faction).toBe("alliance");
  });

  it("uses the most recent drop as the current state", async () => {
    const store = new InMemoryBuffStore();
    await store.record(drop("alliance", 100));
    await store.record(drop("alliance", 300)); // later
    await store.record(drop("alliance", 200)); // out of order
    expect((await store.current("alliance", at(1000)))?.appliedAt).toEqual(at(300));
  });

  it("defaults to a two-hour window", async () => {
    const store = new InMemoryBuffStore();
    await store.record(drop("alliance", 0));
    const state = await store.current("alliance", at(0));
    expect(state?.expiresAt.getTime()).toBe(DEFAULT_BUFF_DURATION_MS);
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

  it("records a drop and reads back the latest as current state", async () => {
    const db = fakeDb();
    const store = new MongoBuffStore(db, 1000);
    await store.record(drop("horde", 100));
    await store.record(drop("horde", 250));
    const state = await store.current("horde", at(250.5));
    expect(state?.appliedAt).toEqual(at(250));
    expect(state?.active).toBe(true);
    expect((await store.current("horde", at(1252)))?.active).toBe(false);
  });

  it("returns history ascending (chronological) for measuring the real window", async () => {
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
