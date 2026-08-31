import { MongoClient } from "mongodb";

/**
 * A monotonic count of raids the bot has detected, so each run gets a stable reference
 * number (#834). Persisted so it climbs across restarts instead of resetting to #1 on
 * every deploy. Loaded once on boot, bumped in memory when a raid forms, saved as it
 * goes — one small integer. A raid that spans a restart is re-numbered (the counter never
 * goes backward), which is acceptable for a reference id.
 */
export interface RaidCounterStore {
  /** The current value (0 when nothing has been recorded). */
  load(): Promise<number>;
  /** Persist the latest value. */
  save(value: number): Promise<void>;
  close(): Promise<void>;
}

/** In-memory store — local/test fallback (resets on restart, so no cross-deploy climb). */
export class InMemoryRaidCounterStore implements RaidCounterStore {
  #value: number;

  constructor(initial = 0) {
    this.#value = initial;
  }

  async load(): Promise<number> {
    return this.#value;
  }

  async save(value: number): Promise<void> {
    this.#value = value;
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface CounterDoc {
  readonly _id: string;
  readonly value: number;
}

/** Narrow port over the Mongo collection, so the store's logic is unit-tested with a fake. */
export interface RaidCounterDb {
  get(): Promise<number | null>;
  set(value: number): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "counters";
const DOC_ID = "raid";

export class MongoRaidCounterStore implements RaidCounterStore {
  readonly #db: RaidCounterDb;

  constructor(db: RaidCounterDb) {
    this.#db = db;
  }

  static async connect(uri: string, dbName: string = DEFAULT_DB): Promise<MongoRaidCounterStore> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<CounterDoc>(COLLECTION);
    const db: RaidCounterDb = {
      get: () => collection.findOne({ _id: DOC_ID }).then((doc) => doc?.value ?? null),
      set: (value) =>
        collection.updateOne({ _id: DOC_ID }, { $set: { value } }, { upsert: true }).then(() => undefined),
      close: () => client.close(),
    };
    return new MongoRaidCounterStore(db);
  }

  async load(): Promise<number> {
    return (await this.#db.get()) ?? 0;
  }

  async save(value: number): Promise<void> {
    await this.#db.set(value);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
