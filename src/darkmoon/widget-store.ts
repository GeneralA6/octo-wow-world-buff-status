import { MongoClient } from "mongodb";

/**
 * Remembers which Discord message the Darkmoon board owns.
 *
 * One string, but it has to survive a redeploy: without it every restart posts a fresh board and
 * orphans the last, which is exactly the channel-spamming the server-status widget's store was
 * added to stop. Kept apart from the faire KNOWLEDGE document on purpose — one is what we know
 * about the world, the other is which message we happen to be editing, and a wipe of either should
 * not take the other with it.
 */

export interface DarkmoonWidgetState {
  /** The message the board edits in place, or null before it has ever been posted. */
  readonly messageId: string | null;
}

export interface DarkmoonWidgetStore {
  load(): Promise<DarkmoonWidgetState | null>;
  save(state: DarkmoonWidgetState): Promise<void>;
  close(): Promise<void>;
}

/** In-memory store — local/test fallback. Resets on restart, so the board reposts once. */
export class InMemoryDarkmoonWidgetStore implements DarkmoonWidgetStore {
  #state: DarkmoonWidgetState | null;

  constructor(initial: DarkmoonWidgetState | null = null) {
    this.#state = initial;
  }

  async load(): Promise<DarkmoonWidgetState | null> {
    return this.#state;
  }

  async save(state: DarkmoonWidgetState): Promise<void> {
    this.#state = state;
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface WidgetDoc {
  readonly _id: string;
  readonly messageId: string | null;
}

/** Narrow port over the Mongo collection, so the store's logic is unit-tested with a fake. */
export interface DarkmoonWidgetDb {
  get(): Promise<DarkmoonWidgetState | null>;
  set(state: DarkmoonWidgetState): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "darkmoon";
const DOC_ID = "widget";

export class MongoDarkmoonWidgetStore implements DarkmoonWidgetStore {
  readonly #db: DarkmoonWidgetDb;

  constructor(db: DarkmoonWidgetDb) {
    this.#db = db;
  }

  static async connect(uri: string, dbName: string = DEFAULT_DB): Promise<MongoDarkmoonWidgetStore> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<WidgetDoc>(COLLECTION);
    const db: DarkmoonWidgetDb = {
      get: () =>
        collection.findOne({ _id: DOC_ID }).then((doc) => (doc ? { messageId: doc.messageId } : null)),
      set: (state) =>
        collection
          .updateOne({ _id: DOC_ID }, { $set: { messageId: state.messageId } }, { upsert: true })
          .then(() => undefined),
      close: () => client.close(),
    };
    return new MongoDarkmoonWidgetStore(db);
  }

  async load(): Promise<DarkmoonWidgetState | null> {
    return this.#db.get();
  }

  async save(state: DarkmoonWidgetState): Promise<void> {
    await this.#db.set(state);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
