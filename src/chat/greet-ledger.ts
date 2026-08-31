import { MongoClient } from "mongodb";

/**
 * Remembers which players Bufftracker has already greeted after they contacted a parked
 * listener, so the one-time introduction is sent ONCE — not again every time the process
 * restarts. The in-memory `#greeted` set it replaces reset on every redeploy, and the bot
 * redeploys nightly, so a regular of the capital was re-greeted daily.
 *
 * `claim` is the atomic primitive: it records the greeting and reports whether THIS call
 * was the first, so two whispers racing in still greet at most once. Rows carry a
 * `greetedAt` with a TTL, so a player not seen for months is eventually greeted again
 * (a welcome-back, not spam) and the collection never grows without bound.
 */

/** Re-greet a returning player only after this long without contact. */
const GREET_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export interface GreetLedger {
  /** Record a first greeting for this player. True if newly greeted, false if already greeted. */
  claim(name: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Canonical case-insensitive key for a character name. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

/** In-memory ledger — the local/test fallback and the shape the Mongo store mirrors. */
export class InMemoryGreetLedger implements GreetLedger {
  readonly #greeted = new Set<string>();

  async claim(name: string): Promise<boolean> {
    const k = key(name);
    if (!k || this.#greeted.has(k)) return false;
    this.#greeted.add(k);
    return true;
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface GreetDoc {
  readonly _id: string;
  readonly name: string;
  readonly greetedAt: Date;
}

/** Narrow port over the Mongo collection, so the ledger's logic is unit-tested with a fake. */
export interface GreetDb {
  /** Insert if absent; true when this call created the row (the first greeting). */
  insertIfAbsent(doc: GreetDoc): Promise<boolean>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "greeted";

export class MongoGreetLedger implements GreetLedger {
  readonly #db: GreetDb;

  constructor(db: GreetDb) {
    this.#db = db;
  }

  static async connect(uri: string, dbName: string = DEFAULT_DB): Promise<MongoGreetLedger> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<GreetDoc>(COLLECTION);
    await collection.createIndex({ greetedAt: 1 }, { expireAfterSeconds: GREET_TTL_SECONDS });
    const db: GreetDb = {
      insertIfAbsent: ({ _id, ...rest }) =>
        collection
          .updateOne({ _id }, { $setOnInsert: rest }, { upsert: true })
          .then((result) => result.upsertedCount === 1),
      close: () => client.close(),
    };
    return new MongoGreetLedger(db);
  }

  async claim(name: string): Promise<boolean> {
    const k = key(name);
    if (!k) return false;
    return this.#db.insertIfAbsent({ _id: k, name: name.trim(), greetedAt: new Date() });
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
