import { MongoClient } from "mongodb";

/**
 * Persists the live server-status widget's durable state so it survives a restart:
 *
 *  - `messageId` — the ONE message the widget edits in place. Without persisting it, every
 *    redeploy would post a fresh widget and orphan the last, spamming #server-status (the same
 *    bombardment the realm-outage store was added to stop, one file over).
 *  - the last finished outage — the ServerMonitor clears `downSince` once recovery is confirmed,
 *    so "last outage: 2h ago, 12m" has nowhere else to live after the realm is back.
 *
 * One tiny document, loaded once on boot and saved on each change (new message, outage closed).
 */
export interface ServerStatusWidgetState {
  /** The widget message the bot edits in place, or null before it has ever been posted. */
  readonly messageId: string | null;
  /** When the most recent outage ended (epoch ms), or null if none has been recorded. */
  readonly lastOutageEndedAt: number | null;
  /** How long that outage lasted (ms), or null. */
  readonly lastOutageDurationMs: number | null;
}

export interface ServerStatusWidgetStore {
  /** The last persisted state, or null if none has ever been saved (a fresh install). */
  load(): Promise<ServerStatusWidgetState | null>;
  /** Persist the latest state. */
  save(state: ServerStatusWidgetState): Promise<void>;
  close(): Promise<void>;
}

/** In-memory store — local/test fallback (resets on restart, so the widget reposts once). */
export class InMemoryServerStatusWidgetStore implements ServerStatusWidgetStore {
  #state: ServerStatusWidgetState | null;

  constructor(initial: ServerStatusWidgetState | null = null) {
    this.#state = initial;
  }

  async load(): Promise<ServerStatusWidgetState | null> {
    return this.#state;
  }

  async save(state: ServerStatusWidgetState): Promise<void> {
    this.#state = state;
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface WidgetDoc {
  readonly _id: string;
  readonly messageId: string | null;
  readonly lastOutageEndedAt: number | null;
  readonly lastOutageDurationMs: number | null;
}

/** Narrow port over the Mongo collection, so the store's logic is unit-tested with a fake. */
export interface ServerStatusWidgetDb {
  get(): Promise<ServerStatusWidgetState | null>;
  set(state: ServerStatusWidgetState): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "widgets";
const DOC_ID = "status";

/** The document (minus its fixed `_id`) — pure, so the round-trip is pinned by a test. */
export function stateToDoc(state: ServerStatusWidgetState): Omit<WidgetDoc, "_id"> {
  return {
    messageId: state.messageId,
    lastOutageEndedAt: state.lastOutageEndedAt,
    lastOutageDurationMs: state.lastOutageDurationMs,
  };
}

/** Read a stored document back into state, ignoring the `_id`. */
export function docToState(doc: WidgetDoc): ServerStatusWidgetState {
  return {
    messageId: doc.messageId,
    lastOutageEndedAt: doc.lastOutageEndedAt,
    lastOutageDurationMs: doc.lastOutageDurationMs,
  };
}

export class MongoServerStatusWidgetStore implements ServerStatusWidgetStore {
  readonly #db: ServerStatusWidgetDb;

  constructor(db: ServerStatusWidgetDb) {
    this.#db = db;
  }

  static async connect(uri: string, dbName: string = DEFAULT_DB): Promise<MongoServerStatusWidgetStore> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<WidgetDoc>(COLLECTION);
    const db: ServerStatusWidgetDb = {
      get: () => collection.findOne({ _id: DOC_ID }).then((doc) => (doc ? docToState(doc) : null)),
      set: (state) =>
        collection
          .updateOne({ _id: DOC_ID }, { $set: stateToDoc(state) }, { upsert: true })
          .then(() => undefined),
      close: () => client.close(),
    };
    return new MongoServerStatusWidgetStore(db);
  }

  async load(): Promise<ServerStatusWidgetState | null> {
    return this.#db.get();
  }

  async save(state: ServerStatusWidgetState): Promise<void> {
    await this.#db.set(state);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
