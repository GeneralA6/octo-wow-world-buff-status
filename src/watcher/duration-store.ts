import { MongoClient } from "mongodb";

/**
 * Records how long each observed Onyxia raid took (form → clear) so the forming
 * heads-up can predict a raid's end from the LEARNED median instead of a fixed config
 * guess. Self-improving: the more raids it sees, the better the estimate.
 *
 * The median is used (not the mean) because clear times are right-skewed — a wipe or a
 * stalled raid drags the mean up, while the median tracks the typical run. It is only
 * returned once at least `minSamples` are in hand, so a couple of early raids can't set
 * a wild estimate.
 */
export interface RaidDuration {
  readonly ms: number;
  readonly ts: Date;
}

export interface DurationStore {
  record(duration: RaidDuration): Promise<void>;
  /** Median clear time (ms) once at least `minSamples` are recorded, else null. */
  median(minSamples: number): Promise<number | null>;
  count(): Promise<number>;
  close(): Promise<void>;
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** In-memory store — local/test fallback and the shape the Mongo store mirrors. */
export class InMemoryDurationStore implements DurationStore {
  readonly #durations: RaidDuration[] = [];

  async record(duration: RaidDuration): Promise<void> {
    this.#durations.push(duration);
  }
  async median(minSamples: number): Promise<number | null> {
    if (this.#durations.length < minSamples) return null;
    return medianOf(this.#durations.map((d) => d.ms));
  }
  async count(): Promise<number> {
    return this.#durations.length;
  }
  async close(): Promise<void> {
    // nothing to release
  }
}

interface DurationDoc {
  readonly ms: number;
  readonly ts: Date;
}

/** Narrow port over a Mongo collection, so the store's logic is unit-tested with a fake. */
export interface DurationDb {
  insert(doc: DurationDoc): Promise<void>;
  /** Most recent durations, up to `limit`. */
  recent(limit: number): Promise<DurationDoc[]>;
  count(): Promise<number>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "raiddurations";
const DEFAULT_TTL_DAYS = 90;
/** Enough to characterise the current cadence without letting stale weeks dominate. */
const MEDIAN_WINDOW = 200;

export class MongoDurationStore implements DurationStore {
  readonly #db: DurationDb;

  constructor(db: DurationDb) {
    this.#db = db;
  }

  static async connect(
    uri: string,
    dbName: string = DEFAULT_DB,
    ttlDays: number = DEFAULT_TTL_DAYS,
  ): Promise<MongoDurationStore> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<DurationDoc>(COLLECTION);
    await collection.createIndex({ ts: 1 }, { expireAfterSeconds: ttlDays * 86_400 });
    const db: DurationDb = {
      insert: (doc) => collection.insertOne(doc).then(() => undefined),
      recent: (limit) => collection.find().sort({ ts: -1 }).limit(limit).toArray(),
      count: () => collection.countDocuments(),
      close: () => client.close(),
    };
    return new MongoDurationStore(db);
  }

  async record(duration: RaidDuration): Promise<void> {
    await this.#db.insert({ ms: duration.ms, ts: duration.ts });
  }

  async median(minSamples: number): Promise<number | null> {
    const docs = await this.#db.recent(MEDIAN_WINDOW);
    if (docs.length < minSamples) return null;
    return medianOf(docs.map((d) => d.ms));
  }

  async count(): Promise<number> {
    return this.#db.count();
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
