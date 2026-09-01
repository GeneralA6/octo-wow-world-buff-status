import { MongoClient } from "mongodb";
import { subscriberKey } from "./store.js";

/**
 * An append-only ledger of every distinct player who has EVER subscribed — a lifetime user
 * count for statistics, unaffected by unsubscribing. The subscriber store removes an active
 * subscriber on unsubscribe (so alerts never reach them); this keeps the name so the total can't
 * shrink. Kept SEPARATE from the subscriber store on purpose: the active set decides who gets
 * alerts, and a lifetime metric must never be able to leak an unsubscribed person into that.
 *
 * Keyed by the same case-insensitive character key as the subscriber store, so one person counts
 * once whatever the casing. Idempotent (a unique index), and — unlike the intro store — it never
 * expires: a lifetime total is forever.
 */
export interface UserLedger {
  /** Record that `name` has been a subscriber at some point. Idempotent. */
  record(name: string): Promise<void>;
  /** How many distinct people have ever subscribed. */
  count(): Promise<number>;
  close(): Promise<void>;
}

/** In-memory ledger — local/test fallback and the shape the Mongo ledger mirrors. */
export class InMemoryUserLedger implements UserLedger {
  readonly #names = new Set<string>();

  async record(name: string): Promise<void> {
    this.#names.add(subscriberKey(name));
  }
  async count(): Promise<number> {
    return this.#names.size;
  }
  async close(): Promise<void> {
    // nothing to release
  }
}

interface UserDoc {
  readonly name: string; // canonical case-insensitive key
  readonly firstSeen: Date;
}

/** Narrow port over a Mongo collection, so the ledger's logic is unit-tested with a fake. */
export interface UserDb {
  /** Insert the key if absent (keeps the earliest firstSeen). Idempotent. */
  upsert(key: string, firstSeen: Date): Promise<void>;
  count(): Promise<number>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "users";

export class MongoUserLedger implements UserLedger {
  readonly #db: UserDb;

  constructor(db: UserDb) {
    this.#db = db;
  }

  static async connect(uri: string, dbName: string = DEFAULT_DB): Promise<MongoUserLedger> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<UserDoc>(COLLECTION);
    await collection.createIndex({ name: 1 }, { unique: true });
    const db: UserDb = {
      upsert: (key, firstSeen) =>
        collection
          .updateOne({ name: key }, { $setOnInsert: { name: key, firstSeen } }, { upsert: true })
          .then(() => undefined),
      count: () => collection.countDocuments(),
      close: () => client.close(),
    };
    return new MongoUserLedger(db);
  }

  async record(name: string): Promise<void> {
    await this.#db.upsert(subscriberKey(name), new Date());
  }

  async count(): Promise<number> {
    return this.#db.count();
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
