import { MongoClient } from "mongodb";
import { type Subscriber, type SubscriberStore, subscriberKey } from "./store.js";

/** One subscriber document; `_id` is the canonical lowercased name (free uniqueness). */
export interface SubscriberDoc {
  readonly _id: string;
  readonly name: string;
  readonly subscribedAt: Date;
}

export interface UpsertOutcome {
  readonly upsertedCount: number;
}
export interface DeleteOutcome {
  readonly deletedCount: number;
}

/**
 * The narrow slice of a Mongo collection the store needs. `connect()` adapts a real
 * driver Collection to it; tests inject a fake, so the store's logic is covered
 * without a live database.
 */
export interface SubscriberDb {
  upsertNew(key: string, name: string, subscribedAt: Date): Promise<UpsertOutcome>;
  deleteByKey(key: string): Promise<DeleteOutcome>;
  countByKey(key: string): Promise<number>;
  list(): Promise<SubscriberDoc[]>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "subscribers";

/** Subscriber store backed by MongoDB, via the {@link SubscriberDb} port. */
export class MongoSubscriberStore implements SubscriberStore {
  readonly #db: SubscriberDb;

  constructor(db: SubscriberDb) {
    this.#db = db;
  }

  /** Connect to Mongo and return a ready store. Caller must `close()` it. */
  static async connect(uri: string, dbName: string = DEFAULT_DB): Promise<MongoSubscriberStore> {
    const client = new MongoClient(uri);
    await client.connect();
    const collection = client.db(dbName).collection<SubscriberDoc>(COLLECTION);
    const db: SubscriberDb = {
      upsertNew: (key, name, subscribedAt) =>
        collection.updateOne({ _id: key }, { $setOnInsert: { name, subscribedAt } }, { upsert: true }),
      deleteByKey: (key) => collection.deleteOne({ _id: key }),
      countByKey: (key) => collection.countDocuments({ _id: key }, { limit: 1 }),
      list: () => collection.find().toArray(),
      close: () => client.close(),
    };
    return new MongoSubscriberStore(db);
  }

  async add(name: string): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key) return false;
    const result = await this.#db.upsertNew(key, name.trim(), new Date());
    return result.upsertedCount === 1;
  }

  async remove(name: string): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key) return false;
    const result = await this.#db.deleteByKey(key);
    return result.deletedCount === 1;
  }

  async has(name: string): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key) return false;
    return (await this.#db.countByKey(key)) > 0;
  }

  async all(): Promise<Subscriber[]> {
    const docs = await this.#db.list();
    return docs.map((doc) => ({ name: doc.name, subscribedAt: doc.subscribedAt }));
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
