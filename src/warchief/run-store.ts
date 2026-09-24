import type { Db } from "mongodb";
import { releaseSharedClient } from "../mongo-connection.js";
import type { SpireRunEndReason } from "./spire-runs.js";
import { spirePlayer, type SpirePlayer } from "./spire-view.js";

/**
 * The UBRS runs the Spire watch saw finish, kept to score the forecast against the blessings heard
 * — and, with each roster, to test later ideas on (whose Chronicle log a run was, which of its Horde
 * turned the head in). Written once, when a run ends; TTL-expired like the blessings they are scored
 * against.
 */

export interface SpireRunRecord {
  readonly startedAt: Date;
  readonly formedAt: Date;
  readonly endedAt: Date;
  readonly reason: SpireRunEndReason;
  readonly baseline: boolean;
  readonly peak: number;
  readonly horde: number;
  readonly roster: readonly SpirePlayer[];
}

export interface SpireRunStore {
  record(run: SpireRunRecord): Promise<void>;
  /** The runs that ended at or after `from`, in the order they ended. */
  endedSince(from: Date): Promise<SpireRunRecord[]>;
  close(): Promise<void>;
}

const copy = (run: SpireRunRecord): SpireRunRecord => ({ ...run, roster: run.roster.map(spirePlayer) });

/** In-memory store — local/test fallback and the shape the Mongo store mirrors. */
export class InMemorySpireRunStore implements SpireRunStore {
  readonly #runs: SpireRunRecord[] = [];

  async record(run: SpireRunRecord): Promise<void> {
    this.#runs.push(copy(run));
  }

  async endedSince(from: Date): Promise<SpireRunRecord[]> {
    return this.#runs
      .filter((run) => run.endedAt.getTime() >= from.getTime())
      .sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

export interface SpireRunDoc extends Omit<SpireRunRecord, "roster"> {
  readonly roster: SpirePlayer[];
}

/** Narrow port over a Mongo collection, so the store's logic is unit-tested with a fake. */
export interface SpireRunDb {
  insert(doc: SpireRunDoc): Promise<void>;
  /** Documents with endedAt >= from, ascending by endedAt. */
  endedSince(from: Date): Promise<SpireRunDoc[]>;
  close(): Promise<void>;
}

const COLLECTION = "spireruns";
const DEFAULT_TTL_DAYS = 90;

export class MongoSpireRunStore implements SpireRunStore {
  readonly #db: SpireRunDb;

  constructor(db: SpireRunDb) {
    this.#db = db;
  }

  static async open(database: Db, ttlDays: number = DEFAULT_TTL_DAYS): Promise<MongoSpireRunStore> {
    const collection = database.collection<SpireRunDoc>(COLLECTION);
    await collection.createIndex({ endedAt: 1 }, { expireAfterSeconds: ttlDays * 86_400 });
    const db: SpireRunDb = {
      insert: (doc) => collection.insertOne(doc).then(() => undefined),
      endedSince: (from) =>
        collection.find({ endedAt: { $gte: from } }, { projection: { _id: 0 } }).sort({ endedAt: 1 }).toArray(),
      close: releaseSharedClient,
    };
    return new MongoSpireRunStore(db);
  }

  async record(run: SpireRunRecord): Promise<void> {
    const stored = copy(run);
    await this.#db.insert({ ...stored, roster: [...stored.roster] });
  }

  async endedSince(from: Date): Promise<SpireRunRecord[]> {
    return (await this.#db.endedSince(from)).map(copy);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
