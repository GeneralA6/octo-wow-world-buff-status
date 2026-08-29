import { type Subscriber, type SubscriberStore, subscriberKey } from "./store.js";

/** In-memory subscriber store — the local/test fallback when no Mongo is configured. */
export class InMemorySubscriberStore implements SubscriberStore {
  readonly #byKey = new Map<string, Subscriber>();

  async add(name: string): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key || this.#byKey.has(key)) return false;
    this.#byKey.set(key, { name: name.trim(), subscribedAt: new Date() });
    return true;
  }

  async remove(name: string): Promise<boolean> {
    return this.#byKey.delete(subscriberKey(name));
  }

  async has(name: string): Promise<boolean> {
    return this.#byKey.has(subscriberKey(name));
  }

  async all(): Promise<Subscriber[]> {
    return [...this.#byKey.values()];
  }

  async close(): Promise<void> {
    // nothing to release
  }
}
