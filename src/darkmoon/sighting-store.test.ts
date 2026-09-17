import { describe, expect, it, vi } from "vitest";
import {
  docToSighting,
  InMemorySightingStore,
  MongoSightingStore,
  sightingToDoc,
  type SightingDb,
} from "./sighting-store.js";
import type { FaireSighting } from "./resolve.js";

const sighting: FaireSighting = {
  location: "mulgore",
  sightedAt: Date.parse("2026-09-10T12:00:00Z"),
  witness: "Someplayer",
};

describe("InMemorySightingStore", () => {
  it("starts empty and returns what was saved", async () => {
    const store = new InMemorySightingStore();
    expect(await store.load()).toBeNull();
    await store.save(sighting);
    expect(await store.load()).toEqual(sighting);
  });

  it("can be seeded, standing in for a previous run", async () => {
    expect(await new InMemorySightingStore(sighting).load()).toEqual(sighting);
  });
});

describe("document round-trip", () => {
  it("survives a save/load unchanged", () => {
    const doc = { _id: "sighting", ...sightingToDoc(sighting) };
    expect(docToSighting(doc)).toEqual(sighting);
  });

  it("drops a document whose zone is not one the faire visits", () => {
    // Every answer hangs off this field, so a hand-edited document costs us the anchor rather
    // than handing out a zone that does not exist.
    expect(docToSighting({ _id: "sighting", location: "booty bay", sightedAt: 1, witness: "X" })).toBeNull();
    expect(docToSighting({ _id: "sighting", location: "", sightedAt: 1, witness: "X" })).toBeNull();
  });

  it("drops a document with an unusable timestamp", () => {
    expect(docToSighting({ _id: "sighting", location: "mulgore", sightedAt: NaN, witness: "X" })).toBeNull();
  });
});

describe("MongoSightingStore", () => {
  const fakeDb = (initial: FaireSighting | null = null) => {
    let held = initial;
    const db: SightingDb = {
      get: vi.fn(async () => held),
      set: vi.fn(async (next: FaireSighting) => {
        held = next;
      }),
      close: vi.fn(async () => undefined),
    };
    return db;
  };

  it("reads through to the collection", async () => {
    const db = fakeDb(sighting);
    expect(await new MongoSightingStore(db).load()).toEqual(sighting);
    expect(db.get).toHaveBeenCalledTimes(1);
  });

  it("writes through to the collection", async () => {
    const db = fakeDb();
    const store = new MongoSightingStore(db);
    await store.save(sighting);
    expect(db.set).toHaveBeenCalledWith(sighting);
    expect(await store.load()).toEqual(sighting);
  });

  it("releases the client on close", async () => {
    const db = fakeDb();
    await new MongoSightingStore(db).close();
    expect(db.close).toHaveBeenCalledTimes(1);
  });
});
