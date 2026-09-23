import type { Db } from "mongodb";
import { releaseSharedClient } from "../mongo-connection.js";

/**
 * Remembers every player who has killed a bot listener.
 *
 * Learned one death at a time, so nothing could rebuild it: it has to survive a redeploy. Kept apart
 * from the wall's message id on purpose — one is who the bot will no longer deal with, the other is
 * which Discord message happens to show them, and losing either must not take the other with it.
 */

export interface ShameListStore {
  /** The players, in the order they first killed a listener; empty on a fresh install. */
  load(): Promise<readonly string[]>;
  save(names: readonly string[]): Promise<void>;
  close(): Promise<void>;
}

/** In-memory store — local/test fallback. Forgets everyone on restart. */
export class InMemoryShameListStore implements ShameListStore {
  #names: readonly string[];

  constructor(initial: readonly string[] = []) {
    this.#names = initial;
  }

  async load(): Promise<readonly string[]> {
    return this.#names;
  }

  async save(names: readonly string[]): Promise<void> {
    this.#names = names;
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

interface ShameListDoc {
  readonly _id: string;
  readonly names: string[];
}

/** Narrow port over the Mongo collection, so the store's logic is unit-tested with a fake. */
export interface ShameListDb {
  get(): Promise<readonly string[]>;
  set(names: readonly string[]): Promise<void>;
  close(): Promise<void>;
}

const COLLECTION = "wallOfShame";
const DOC_ID = "players";

export class MongoShameListStore implements ShameListStore {
  readonly #db: ShameListDb;

  constructor(db: ShameListDb) {
    this.#db = db;
  }

  static async open(database: Db): Promise<MongoShameListStore> {
    const collection = database.collection<ShameListDoc>(COLLECTION);
    const db: ShameListDb = {
      get: () => collection.findOne({ _id: DOC_ID }).then((doc) => doc?.names ?? []),
      set: (names) =>
        collection
          .updateOne({ _id: DOC_ID }, { $set: { names: [...names] } }, { upsert: true })
          .then(() => undefined),
      close: releaseSharedClient,
    };
    return new MongoShameListStore(db);
  }

  async load(): Promise<readonly string[]> {
    return this.#db.get();
  }

  async save(names: readonly string[]): Promise<void> {
    await this.#db.set(names);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
