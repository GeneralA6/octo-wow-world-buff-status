import { describe, expect, it, vi } from "vitest";
import {
  InMemorySpireRunStore,
  MongoSpireRunStore,
  type SpireRunDb,
  type SpireRunDoc,
  type SpireRunRecord,
} from "./run-store.js";

const MIN = 60_000;

const record = (endMin: number): SpireRunRecord => ({
  startedAt: new Date((endMin - 40) * MIN),
  formedAt: new Date((endMin - 35) * MIN),
  endedAt: new Date(endMin * MIN),
  reason: "left",
  baseline: false,
  peak: 10,
  horde: 4,
  roster: [{ name: "Grom", guild: "Warsong", level: 60, classId: 1, raceId: 2 }],
});

describe("InMemorySpireRunStore", () => {
  it("returns the runs that ended since a moment, in the order they ended", async () => {
    const store = new InMemorySpireRunStore();
    await store.record(record(300));
    await store.record(record(100));
    await store.record(record(200));
    const got = await store.endedSince(new Date(200 * MIN));
    expect(got.map((r) => r.endedAt.getTime() / MIN)).toEqual([200, 300]);
  });
});

describe("MongoSpireRunStore", () => {
  function fakeDb(): SpireRunDb & { docs: SpireRunDoc[] } {
    const docs: SpireRunDoc[] = [];
    return {
      docs,
      insert: vi.fn(async (doc) => {
        docs.push(doc);
      }),
      endedSince: vi.fn(async (from: Date) =>
        docs.filter((d) => d.endedAt >= from).sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime()),
      ),
      close: vi.fn(async () => {}),
    };
  }

  it("stores the roster without anything but each player's /who fields", async () => {
    const db = fakeDb();
    const withZone = { ...record(100).roster[0]!, areaId: 1583 };
    await new MongoSpireRunStore(db).record({ ...record(100), roster: [withZone] });
    expect(db.docs[0]?.roster).toEqual(record(100).roster);
  });

  it("reads the finished runs back in the order they ended", async () => {
    const db = fakeDb();
    const store = new MongoSpireRunStore(db);
    await store.record(record(200));
    await store.record(record(100));
    const got = await store.endedSince(new Date(0));
    expect(got.map((r) => r.endedAt.getTime() / MIN)).toEqual([100, 200]);
    expect(got[0]).toMatchObject({ reason: "left", peak: 10, horde: 4 });
  });

  it("releases through the port on close", async () => {
    const db = fakeDb();
    await new MongoSpireRunStore(db).close();
    expect(db.close).toHaveBeenCalledOnce();
  });
});
