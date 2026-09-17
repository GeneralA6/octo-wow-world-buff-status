import { MongoClient } from "mongodb";
import { isFaireLocation } from "./schedule.js";
import type { FaireSighting } from "./resolve.js";

/**
 * Persists the newest Darkmoon Faire sighting heard on the LFT channel.
 *
 * Worth a document of its own because a sighting is not just "where the faire is this week" — it
 * is the one fact that pins the calendar's zone alternation, and that fact is good forever (see
 * `resolve.ts`). Losing it on a redeploy would drop the bot back to the shipped guess until the
 * next faire week came around to re-teach it, which can be most of a month.
 *
 * One tiny document, loaded once on boot and written only when a strictly newer sighting arrives.
 */

export interface SightingStore {
  /** The stored sighting, or null if none has ever been recorded. */
  load(): Promise<FaireSighting | null>;
  save(sighting: FaireSighting): Promise<void>;
  close(): Promise<void>;
}

/** In-memory store — local/test fallback (resets on restart, so the anchor reverts to the guess). */
export class InMemorySightingStore implements SightingStore {
  #sighting: FaireSighting | null;

  constructor(initial: FaireSighting | null = null) {
    this.#sighting = initial;
  }

  async load(): Promise<FaireSighting | null> {
    return this.#sighting;
  }

  async save(sighting: FaireSighting): Promise<void> {
    this.#sighting = sighting;
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface SightingDoc {
  readonly _id: string;
  readonly location: string;
  readonly sightedAt: number;
  readonly witness: string;
}

/** Narrow port over the Mongo collection, so the store's logic is unit-tested with a fake. */
export interface SightingDb {
  get(): Promise<FaireSighting | null>;
  set(sighting: FaireSighting): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "darkmoon";
const DOC_ID = "sighting";

export function sightingToDoc(sighting: FaireSighting): Omit<SightingDoc, "_id"> {
  return { location: sighting.location, sightedAt: sighting.sightedAt, witness: sighting.witness };
}

/**
 * Read a stored document back. The location is re-validated rather than trusted: it is the field
 * every answer hangs off, and a hand-edited or half-written document should cost us the anchor,
 * not hand out a wrong zone with full confidence.
 */
export function docToSighting(doc: SightingDoc): FaireSighting | null {
  if (!isFaireLocation(doc.location)) return null;
  if (!Number.isFinite(doc.sightedAt)) return null;
  return { location: doc.location, sightedAt: doc.sightedAt, witness: doc.witness };
}

export class MongoSightingStore implements SightingStore {
  readonly #db: SightingDb;

  constructor(db: SightingDb) {
    this.#db = db;
  }

  static async connect(uri: string, dbName: string = DEFAULT_DB): Promise<MongoSightingStore> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<SightingDoc>(COLLECTION);
    const db: SightingDb = {
      get: () => collection.findOne({ _id: DOC_ID }).then((doc) => (doc ? docToSighting(doc) : null)),
      set: (sighting) =>
        collection
          .updateOne({ _id: DOC_ID }, { $set: sightingToDoc(sighting) }, { upsert: true })
          .then(() => undefined),
      close: () => client.close(),
    };
    return new MongoSightingStore(db);
  }

  async load(): Promise<FaireSighting | null> {
    return this.#db.get();
  }

  async save(sighting: FaireSighting): Promise<void> {
    await this.#db.set(sighting);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
