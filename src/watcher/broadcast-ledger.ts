import { MongoClient } from "mongodb";
import type { Faction } from "./buff-store.js";
import type { RaidEvent } from "./raid-tracker.js";

/**
 * Remembers the last park-alert we broadcast for each (city, kind), so a repeat of the
 * SAME buff cycle is suppressed no matter what shook the roster loose:
 *
 *   - a redeploy re-reads /who and sees the raid already in progress ("underway"),
 *   - a wipe drops the count below the clear line and it climbs back ("cleared" twice),
 *   - ordinary churn wobbles the count across a threshold.
 *
 * None of those is a new reason to park. The dedup is keyed to the buff CYCLE (the pending
 * window before a fresh Rallying Cry drops), not to the in-memory raid detector — which is
 * exactly why it lives in the DB and survives a restart. `shouldBroadcast` decides; the
 * store just persists the timestamps. There are only ever a handful of rows (cities × kinds).
 */

export type RaidEventKind = RaidEvent["kind"];
/** The dedup keys the ledger tracks: one per raid-event alert (forming, cleared), plus the
 *  "about to clear" heads-up, which has no RaidEvent of its own (it fires from a raid's elapsed
 *  time crossing its predicted-clear lead, not from a detector). */
export type BroadcastKind = RaidEventKind | "raid-ending";

export interface BroadcastRecord {
  readonly city: Faction;
  readonly kind: BroadcastKind;
  /** The raid group this alert was about, for the log and the status query. */
  readonly cohortLabel: string;
  readonly peak: number;
  /** When we last broadcast this (city, kind). */
  readonly lastBroadcastAt: Date;
}

/**
 * Is a park-alert for (city, kind) a fresh one worth sending, or one we've already sent
 * this cycle? A cycle ends when a fresh buff actually drops for that city, so:
 *
 *   - never broadcast before  → yes,
 *   - a buff has dropped since our last broadcast (`lastBuffDropAt` is newer) → new cycle, yes,
 *   - our last broadcast is older than `maxCycleMs` → stale (e.g. a run whose buff we never
 *     heard), so don't stay muted forever → yes,
 *   - otherwise we already spoke this pending cycle → no.
 */
export function shouldBroadcast(
  last: Pick<BroadcastRecord, "lastBroadcastAt"> | null,
  lastBuffDropAt: Date | null,
  now: number,
  maxCycleMs: number,
): boolean {
  if (!last) return true;
  if (now - last.lastBroadcastAt.getTime() >= maxCycleMs) return true;
  if (lastBuffDropAt && lastBuffDropAt.getTime() > last.lastBroadcastAt.getTime()) return true;
  return false;
}

export interface BroadcastLedger {
  /** The last broadcast for a (city, kind), or null if there's never been one. */
  last(city: Faction, kind: BroadcastKind): Promise<BroadcastRecord | null>;
  /** Record a broadcast we just sent (upsert on city+kind). */
  record(rec: BroadcastRecord): Promise<void>;
  close(): Promise<void>;
}

function key(city: Faction, kind: BroadcastKind): string {
  return `${city}:${kind}`;
}

/** In-memory ledger — local/test fallback and the shape the Mongo store mirrors. */
export class InMemoryBroadcastLedger implements BroadcastLedger {
  readonly #records = new Map<string, BroadcastRecord>();

  async last(city: Faction, kind: BroadcastKind): Promise<BroadcastRecord | null> {
    return this.#records.get(key(city, kind)) ?? null;
  }

  async record(rec: BroadcastRecord): Promise<void> {
    this.#records.set(key(rec.city, rec.kind), rec);
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface BroadcastDoc {
  readonly city: Faction;
  readonly kind: BroadcastKind;
  readonly cohortLabel: string;
  readonly peak: number;
  readonly lastBroadcastAt: Date;
}

/** Narrow port over the Mongo collection, so the ledger's logic is unit-tested with a fake. */
export interface BroadcastDb {
  get(city: Faction, kind: BroadcastKind): Promise<BroadcastDoc | null>;
  upsert(doc: BroadcastDoc): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "broadcasts";

export class MongoBroadcastLedger implements BroadcastLedger {
  readonly #db: BroadcastDb;

  constructor(db: BroadcastDb) {
    this.#db = db;
  }

  static async connect(uri: string, dbName: string = DEFAULT_DB): Promise<MongoBroadcastLedger> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<BroadcastDoc>(COLLECTION);
    await collection.createIndex({ city: 1, kind: 1 }, { unique: true });
    const db: BroadcastDb = {
      get: (city, kind) => collection.findOne({ city, kind }),
      upsert: (doc) =>
        collection
          .updateOne({ city: doc.city, kind: doc.kind }, { $set: doc }, { upsert: true })
          .then(() => undefined),
      close: () => client.close(),
    };
    return new MongoBroadcastLedger(db);
  }

  async last(city: Faction, kind: BroadcastKind): Promise<BroadcastRecord | null> {
    const doc = await this.#db.get(city, kind);
    return doc
      ? {
          city: doc.city,
          kind: doc.kind,
          cohortLabel: doc.cohortLabel,
          peak: doc.peak,
          lastBroadcastAt: doc.lastBroadcastAt,
        }
      : null;
  }

  async record(rec: BroadcastRecord): Promise<void> {
    await this.#db.upsert({
      city: rec.city,
      kind: rec.kind,
      cohortLabel: rec.cohortLabel,
      peak: rec.peak,
      lastBroadcastAt: rec.lastBroadcastAt,
    });
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
