import { MongoClient } from "mongodb";

/**
 * Remembers when the Rallying Cry of the Dragonslayer buff was applied, PER FACTION,
 * so the notifier can tell whether a fresh drop is even possible right now.
 *
 * The mechanic that makes this the whole game: turning in a dragon head only grants
 * the city-wide buff when no head is already hanging, and a hanging head blocks the
 * next drop for the buff's own duration (2h on retail). So while a buff is active,
 * a finishing raid's head is BANKED — no imminent drop — and we should stay quiet.
 *
 * Every drop is kept (they are sparse — a few per day) so the real window can be
 * MEASURED later from the interval between successive drops rather than trusting the
 * 2h constant, which a private server may retune. A TTL index bounds the history.
 */

export type Faction = "alliance" | "horde";
export const FACTIONS: readonly Faction[] = ["alliance", "horde"] as const;

/** Rallying Cry lasts 2h, and a hanging head blocks the next drop for the same window. */
export const DEFAULT_BUFF_DURATION_MS = 2 * 60 * 60 * 1000;

export interface BuffDrop {
  readonly faction: Faction;
  /** When the buff was applied (the yell fired). */
  readonly appliedAt: Date;
}

export interface BuffState {
  readonly faction: Faction;
  readonly appliedAt: Date;
  /** appliedAt + the buff duration — the earliest a fresh drop becomes possible again. */
  readonly expiresAt: Date;
  /** True if the buff is still up at the `now` the caller asked about. */
  readonly active: boolean;
}

export interface BuffStore {
  /** Record a buff drop (a heard yell). */
  record(drop: BuffDrop): Promise<void>;
  /** The latest drop for a faction as state at `now`, or null if none was ever seen. */
  current(faction: Faction, now: Date): Promise<BuffState | null>;
  /** The last `limit` drops for a faction, chronological (ascending) — for measuring the real window. */
  history(faction: Faction, limit: number): Promise<BuffDrop[]>;
  close(): Promise<void>;
}

function toState(latest: BuffDrop, durationMs: number, now: Date): BuffState {
  const expiresAt = new Date(latest.appliedAt.getTime() + durationMs);
  return {
    faction: latest.faction,
    appliedAt: latest.appliedAt,
    expiresAt,
    active: now.getTime() < expiresAt.getTime(),
  };
}

/** In-memory store — local/test fallback and the shape the Mongo store mirrors. */
export class InMemoryBuffStore implements BuffStore {
  readonly #drops: BuffDrop[] = [];
  readonly #durationMs: number;

  constructor(durationMs: number = DEFAULT_BUFF_DURATION_MS) {
    this.#durationMs = durationMs;
  }

  async record(drop: BuffDrop): Promise<void> {
    this.#drops.push(drop);
  }

  async current(faction: Faction, now: Date): Promise<BuffState | null> {
    let latest: BuffDrop | null = null;
    for (const drop of this.#drops) {
      if (drop.faction !== faction) continue;
      if (!latest || drop.appliedAt.getTime() > latest.appliedAt.getTime()) latest = drop;
    }
    return latest ? toState(latest, this.#durationMs, now) : null;
  }

  async history(faction: Faction, limit: number): Promise<BuffDrop[]> {
    const forFaction = this.#drops
      .filter((drop) => drop.faction === faction)
      .sort((a, b) => a.appliedAt.getTime() - b.appliedAt.getTime());
    return forFaction.slice(Math.max(0, forFaction.length - limit));
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface BuffDoc {
  readonly faction: Faction;
  readonly appliedAt: Date;
}

/** Narrow port over a Mongo collection, so the store's logic is unit-tested with a fake. */
export interface BuffDb {
  insert(doc: BuffDoc): Promise<void>;
  /** Most recent drops for a faction, descending by appliedAt. */
  latest(faction: Faction, limit: number): Promise<BuffDoc[]>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "buffdrops";
const DEFAULT_TTL_DAYS = 90;

export class MongoBuffStore implements BuffStore {
  readonly #db: BuffDb;
  readonly #durationMs: number;

  constructor(db: BuffDb, durationMs: number = DEFAULT_BUFF_DURATION_MS) {
    this.#db = db;
    this.#durationMs = durationMs;
  }

  static async connect(
    uri: string,
    dbName: string = DEFAULT_DB,
    durationMs: number = DEFAULT_BUFF_DURATION_MS,
    ttlDays: number = DEFAULT_TTL_DAYS,
  ): Promise<MongoBuffStore> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<BuffDoc>(COLLECTION);
    await collection.createIndex({ appliedAt: 1 }, { expireAfterSeconds: ttlDays * 86_400 });
    await collection.createIndex({ faction: 1, appliedAt: -1 });
    const db: BuffDb = {
      insert: (doc) => collection.insertOne(doc).then(() => undefined),
      latest: (faction, limit) =>
        collection.find({ faction }).sort({ appliedAt: -1 }).limit(limit).toArray(),
      close: () => client.close(),
    };
    return new MongoBuffStore(db, durationMs);
  }

  async record(drop: BuffDrop): Promise<void> {
    await this.#db.insert({ faction: drop.faction, appliedAt: drop.appliedAt });
  }

  async current(faction: Faction, now: Date): Promise<BuffState | null> {
    const [latest] = await this.#db.latest(faction, 1);
    return latest ? toState(latest, this.#durationMs, now) : null;
  }

  async history(faction: Faction, limit: number): Promise<BuffDrop[]> {
    const docs = await this.#db.latest(faction, limit);
    return docs.reverse().map((doc) => ({ faction: doc.faction, appliedAt: doc.appliedAt }));
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
