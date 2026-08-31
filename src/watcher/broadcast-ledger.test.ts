import { describe, expect, it, vi } from "vitest";
import {
  InMemoryBroadcastLedger,
  MongoBroadcastLedger,
  shouldBroadcast,
  type BroadcastDb,
  type BroadcastRecord,
  type RaidEventKind,
} from "./broadcast-ledger.js";
import type { Faction } from "./buff-store.js";

const at = (sec: number): Date => new Date(sec * 1000);
const rec = (city: Faction, kind: RaidEventKind, sec: number): BroadcastRecord => ({
  city,
  kind,
  cohortLabel: "the lair",
  peak: 40,
  lastBroadcastAt: at(sec),
});

const HOUR = 3_600_000;

describe("shouldBroadcast", () => {
  it("broadcasts when there is no prior record", () => {
    expect(shouldBroadcast(null, null, 1000, HOUR)).toBe(true);
  });

  it("suppresses a repeat within the same cycle (no fresh drop, not stale)", () => {
    const last = { lastBroadcastAt: at(1000) };
    // Half an hour later, no buff has dropped since — same pending cycle.
    expect(shouldBroadcast(last, null, 1000_000 + 1800_000, HOUR)).toBe(false);
  });

  it("suppresses across a would-be re-fire even if a buff dropped BEFORE the last broadcast", () => {
    const last = { lastBroadcastAt: at(2000) };
    const droppedEarlier = at(1000); // older than our last broadcast → not a new cycle
    expect(shouldBroadcast(last, droppedEarlier, 2000_000 + 60_000, HOUR)).toBe(false);
  });

  it("reopens once a fresh buff drops AFTER the last broadcast (a new cycle)", () => {
    const last = { lastBroadcastAt: at(1000) };
    const droppedAfter = at(1500);
    expect(shouldBroadcast(last, droppedAfter, 1500_000 + 10_000, HOUR)).toBe(true);
  });

  it("reopens once the record is older than maxCycleMs (a run whose buff we never heard)", () => {
    const last = { lastBroadcastAt: at(1000) };
    const now = 1000 * 1000 + HOUR; // exactly one window later
    expect(shouldBroadcast(last, null, now, HOUR)).toBe(true);
  });
});

describe("InMemoryBroadcastLedger", () => {
  it("returns null before anything is recorded", async () => {
    const ledger = new InMemoryBroadcastLedger();
    expect(await ledger.last("alliance", "raid-forming")).toBeNull();
  });

  it("records and reads back the latest per (city, kind)", async () => {
    const ledger = new InMemoryBroadcastLedger();
    await ledger.record(rec("alliance", "raid-forming", 100));
    await ledger.record(rec("alliance", "raid-forming", 200)); // upsert-latest
    const last = await ledger.last("alliance", "raid-forming");
    expect(last?.lastBroadcastAt).toEqual(at(200));
  });

  it("keeps city and kind independent", async () => {
    const ledger = new InMemoryBroadcastLedger();
    await ledger.record(rec("alliance", "raid-forming", 100));
    expect(await ledger.last("alliance", "raid-left")).toBeNull();
    expect(await ledger.last("horde", "raid-forming")).toBeNull();
    expect((await ledger.last("alliance", "raid-forming"))?.city).toBe("alliance");
  });
});

describe("MongoBroadcastLedger", () => {
  function fakeDb(): BroadcastDb & { docs: BroadcastRecord[] } {
    const docs: BroadcastRecord[] = [];
    return {
      docs,
      get: vi.fn(async (city: Faction, kind: RaidEventKind) =>
        docs.find((d) => d.city === city && d.kind === kind) ?? null,
      ),
      upsert: vi.fn(async (doc) => {
        const i = docs.findIndex((d) => d.city === doc.city && d.kind === doc.kind);
        if (i >= 0) docs[i] = doc;
        else docs.push(doc);
      }),
      close: vi.fn(async () => {}),
    };
  }

  it("upserts on (city, kind) so there is one row per pair", async () => {
    const db = fakeDb();
    const ledger = new MongoBroadcastLedger(db);
    await ledger.record(rec("horde", "raid-left", 100));
    await ledger.record(rec("horde", "raid-left", 300));
    expect(db.docs).toHaveLength(1);
    expect((await ledger.last("horde", "raid-left"))?.lastBroadcastAt).toEqual(at(300));
  });

  it("returns null for a pair never recorded", async () => {
    const ledger = new MongoBroadcastLedger(fakeDb());
    expect(await ledger.last("alliance", "raid-forming")).toBeNull();
  });

  it("closes the underlying connection", async () => {
    const db = fakeDb();
    await new MongoBroadcastLedger(db).close();
    expect(db.close).toHaveBeenCalled();
  });
});
