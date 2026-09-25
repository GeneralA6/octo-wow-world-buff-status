import type { Db } from "mongodb";
import { releaseSharedClient } from "../mongo-connection.js";
import { spirePlayer, type SpirePlayer } from "./spire-view.js";

/**
 * Every Blackrock Spire reading, kept so the Warchief's Blessing forecast can be REPLAYED on real
 * history and its thresholds tuned offline — the only way to refine it without waiting on live runs.
 *
 * Unlike the lair's snapshots (names only), each player's guild, level, class and race are kept: a
 * UBRS raid and two LBRS parties look alike by headcount, and it is those fields a better tracker
 * will separate them by. One document per poll, TTL-expired; writes are best-effort (the caller
 * swallows errors) so a database hiccup never breaks the poll loop.
 */

export interface SpireSnapshot {
  readonly ts: Date;
  readonly complete: boolean;
  readonly players: readonly SpirePlayer[];
}

export interface SpireSnapshotStore {
  record(snapshot: SpireSnapshot): Promise<void>;
  /** Every snapshot taken in [from, to), oldest first — the order a replay feeds them in. */
  between(from: Date, to: Date): Promise<SpireSnapshot[]>;
  /** When the oldest reading still kept was taken — where the watch's coverage begins — or null. */
  firstTakenAt(): Promise<Date | null>;
  /** When each reading in [from, to) was taken, oldest first — how much the watch saw, without
   *  loading who it saw. */
  takenBetween(from: Date, to: Date): Promise<Date[]>;
  close(): Promise<void>;
}

const copy = (snapshot: SpireSnapshot): SpireSnapshot => ({
  ts: snapshot.ts,
  complete: snapshot.complete,
  players: snapshot.players.map(spirePlayer),
});

/** In-memory store — local/test fallback and the shape the Mongo store mirrors. */
export class InMemorySpireSnapshotStore implements SpireSnapshotStore {
  readonly #all: SpireSnapshot[] = [];

  async record(snapshot: SpireSnapshot): Promise<void> {
    this.#all.push(copy(snapshot));
  }

  async between(from: Date, to: Date): Promise<SpireSnapshot[]> {
    return this.#all
      .filter((s) => s.ts.getTime() >= from.getTime() && s.ts.getTime() < to.getTime())
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  async firstTakenAt(): Promise<Date | null> {
    const times = this.#all.map((s) => s.ts.getTime());
    return times.length > 0 ? new Date(Math.min(...times)) : null;
  }

  async takenBetween(from: Date, to: Date): Promise<Date[]> {
    return (await this.between(from, to)).map((s) => s.ts);
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface SpireSnapshotDoc {
  readonly ts: Date;
  readonly complete: boolean;
  readonly players: SpirePlayer[];
}

/** Narrow port over a Mongo collection, so the store's logic is unit-tested with a fake. */
export interface SpireSnapshotDb {
  insert(doc: SpireSnapshotDoc): Promise<void>;
  /** Documents with from <= ts < to, ascending by ts. */
  range(from: Date, to: Date): Promise<SpireSnapshotDoc[]>;
  /** The oldest document's ts, or null when there are none. */
  oldest(): Promise<Date | null>;
  /** The ts of every document with from <= ts < to, ascending. */
  times(from: Date, to: Date): Promise<Date[]>;
  close(): Promise<void>;
}

const COLLECTION = "spiresnapshots";
/** A month of history is enough to tune on, and bounds a collection written every minute. */
const DEFAULT_TTL_DAYS = 30;

export class MongoSpireSnapshotStore implements SpireSnapshotStore {
  readonly #db: SpireSnapshotDb;

  constructor(db: SpireSnapshotDb) {
    this.#db = db;
  }

  static async open(database: Db, ttlDays: number = DEFAULT_TTL_DAYS): Promise<MongoSpireSnapshotStore> {
    const collection = database.collection<SpireSnapshotDoc>(COLLECTION);
    await collection.createIndex({ ts: 1 }, { expireAfterSeconds: ttlDays * 86_400 });
    const db: SpireSnapshotDb = {
      insert: (doc) => collection.insertOne(doc).then(() => undefined),
      range: (from, to) =>
        collection
          .find({ ts: { $gte: from, $lt: to } }, { projection: { _id: 0 } })
          .sort({ ts: 1 })
          .toArray(),
      oldest: async () => (await collection.findOne({}, { sort: { ts: 1 }, projection: { ts: 1 } }))?.ts ?? null,
      times: async (from, to) =>
        (
          await collection
            .find({ ts: { $gte: from, $lt: to } }, { projection: { _id: 0, ts: 1 } })
            .sort({ ts: 1 })
            .toArray()
        ).map((doc) => doc.ts),
      close: releaseSharedClient,
    };
    return new MongoSpireSnapshotStore(db);
  }

  async record(snapshot: SpireSnapshot): Promise<void> {
    const { ts, complete, players } = copy(snapshot);
    await this.#db.insert({ ts, complete, players: [...players] });
  }

  async between(from: Date, to: Date): Promise<SpireSnapshot[]> {
    const docs = await this.#db.range(from, to);
    return docs.map(copy);
  }

  async firstTakenAt(): Promise<Date | null> {
    return this.#db.oldest();
  }

  async takenBetween(from: Date, to: Date): Promise<Date[]> {
    return this.#db.times(from, to);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
