import { MongoClient } from "mongodb";
import {
  DEFAULT_DELIVERY,
  type DeliveryMode,
  type Subscriber,
  type SubscriberStore,
  type SubscriberUpdate,
  subscriberKey,
} from "./store.js";

/** One subscriber document; `_id` is the canonical lowercased name (free uniqueness). */
export interface SubscriberDoc {
  readonly _id: string;
  readonly name: string;
  readonly discordId: string | null;
  readonly delivery: DeliveryMode;
  readonly subscribedAt: Date;
}

export interface UpsertOutcome {
  readonly upsertedCount: number;
}
export interface DeleteOutcome {
  readonly deletedCount: number;
}
export interface UpdateOutcome {
  readonly matchedCount: number;
}

/**
 * The narrow slice of a Mongo collection the store needs. `connect()` adapts a real
 * driver Collection to it; tests inject a fake, so the store's logic is covered
 * without a live database.
 */
export interface SubscriberDb {
  upsertNew(doc: SubscriberDoc): Promise<UpsertOutcome>;
  deleteByKey(key: string): Promise<DeleteOutcome>;
  countByKey(key: string): Promise<number>;
  getByKey(key: string): Promise<SubscriberDoc | null>;
  setFields(key: string, fields: Partial<Pick<SubscriberDoc, "discordId" | "delivery">>): Promise<UpdateOutcome>;
  list(): Promise<SubscriberDoc[]>;
  close(): Promise<void>;
}

const DEFAULT_DB = "onyxiabot";
const COLLECTION = "subscribers";

function toSubscriber(doc: SubscriberDoc): Subscriber {
  return { name: doc.name, discordId: doc.discordId, delivery: doc.delivery, subscribedAt: doc.subscribedAt };
}

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
      upsertNew: ({ _id, ...rest }) =>
        collection.updateOne({ _id }, { $setOnInsert: rest }, { upsert: true }),
      deleteByKey: (key) => collection.deleteOne({ _id: key }),
      countByKey: (key) => collection.countDocuments({ _id: key }, { limit: 1 }),
      getByKey: (key) => collection.findOne({ _id: key }),
      setFields: (key, fields) => collection.updateOne({ _id: key }, { $set: fields }),
      list: () => collection.find().toArray(),
      close: () => client.close(),
    };
    return new MongoSubscriberStore(db);
  }

  async add(name: string): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key) return false;
    const result = await this.#db.upsertNew({
      _id: key,
      name: name.trim(),
      discordId: null,
      delivery: DEFAULT_DELIVERY,
      subscribedAt: new Date(),
    });
    return result.upsertedCount === 1;
  }

  async remove(name: string): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key) return false;
    return (await this.#db.deleteByKey(key)).deletedCount === 1;
  }

  async has(name: string): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key) return false;
    return (await this.#db.countByKey(key)) > 0;
  }

  async get(name: string): Promise<Subscriber | null> {
    const key = subscriberKey(name);
    if (!key) return null;
    const doc = await this.#db.getByKey(key);
    return doc ? toSubscriber(doc) : null;
  }

  async update(name: string, changes: SubscriberUpdate): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key) return false;
    const fields: { discordId?: string | null; delivery?: DeliveryMode } = {};
    if (changes.discordId !== undefined) fields.discordId = changes.discordId;
    if (changes.delivery !== undefined) fields.delivery = changes.delivery;
    if (Object.keys(fields).length === 0) return this.has(name);
    return (await this.#db.setFields(key, fields)).matchedCount === 1;
  }

  async all(): Promise<Subscriber[]> {
    return (await this.#db.list()).map(toSubscriber);
  }

  async close(): Promise<void> {
    await this.#db.close();
  }
}
