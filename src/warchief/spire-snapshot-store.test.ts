import { describe, expect, it, vi } from "vitest";
import {
  InMemorySpireSnapshotStore,
  MongoSpireSnapshotStore,
  type SpireSnapshot,
  type SpireSnapshotDb,
} from "./spire-snapshot-store.js";
import type { SpirePlayer } from "./spire-view.js";

const player = (name: string): SpirePlayer => ({ name, guild: "Horde Guild", level: 60, classId: 1, raceId: 2 });
const snap = (sec: number, names: string[], complete = true): SpireSnapshot => ({
  ts: new Date(sec * 1000),
  complete,
  players: names.map(player),
});

describe("InMemorySpireSnapshotStore", () => {
  it("returns the snapshots inside [from, to), oldest first", async () => {
    const store = new InMemorySpireSnapshotStore();
    await store.record(snap(3, ["c"]));
    await store.record(snap(1, ["a"]));
    await store.record(snap(2, ["b"]));
    await store.record(snap(4, ["d"]));
    const got = await store.between(new Date(1000), new Date(4000));
    expect(got.map((s) => s.ts.getTime() / 1000)).toEqual([1, 2, 3]);
  });
});

describe("MongoSpireSnapshotStore", () => {
  function fakeDb(): SpireSnapshotDb & { docs: SpireSnapshot[] } {
    const docs: SpireSnapshot[] = [];
    return {
      docs,
      insert: vi.fn(async (doc) => {
        docs.push(doc);
      }),
      range: vi.fn(async (from: Date, to: Date) =>
        docs
          .filter((d) => d.ts >= from && d.ts < to)
          .sort((a, b) => a.ts.getTime() - b.ts.getTime())
          .map((d) => ({ ts: d.ts, complete: d.complete, players: [...d.players] })),
      ),
      close: vi.fn(async () => {}),
    };
  }

  it("stores each player's /who fields without the zone", async () => {
    const db = fakeDb();
    const store = new MongoSpireSnapshotStore(db);
    const inSpire = { ...player("Thrallson"), areaId: 1583 };
    await store.record({ ts: new Date(1000), complete: true, players: [inSpire] });
    expect(db.docs[0]?.players).toEqual([player("Thrallson")]);
  });

  it("keeps its own copy of the players", async () => {
    const db = fakeDb();
    const store = new MongoSpireSnapshotStore(db);
    const players = [player("a")];
    await store.record({ ts: new Date(1000), complete: false, players });
    players.push(player("b"));
    expect(db.docs[0]?.players).toHaveLength(1);
    expect(db.docs[0]?.complete).toBe(false);
  });

  it("reads a time range back in the order a replay needs", async () => {
    const db = fakeDb();
    const store = new MongoSpireSnapshotStore(db);
    await store.record(snap(2, ["b"]));
    await store.record(snap(1, ["a"]));
    await store.record(snap(9, ["z"]));
    const got = await store.between(new Date(0), new Date(5000));
    expect(got.map((s) => s.players.map((p) => p.name))).toEqual([["a"], ["b"]]);
  });

  it("releases through the port on close", async () => {
    const db = fakeDb();
    await new MongoSpireSnapshotStore(db).close();
    expect(db.close).toHaveBeenCalledOnce();
  });
});
