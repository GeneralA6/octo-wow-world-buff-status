import {
  DEFAULT_ALERTS,
  DEFAULT_DELIVERY,
  type Subscriber,
  type SubscriberStore,
  type SubscriberUpdate,
  subscriberKey,
} from "./store.js";

/** In-memory subscriber store — the local/test fallback when no Mongo is configured. */
export class InMemorySubscriberStore implements SubscriberStore {
  readonly #byKey = new Map<string, Subscriber>();

  async add(name: string): Promise<boolean> {
    const key = subscriberKey(name);
    if (!key || this.#byKey.has(key)) return false;
    this.#byKey.set(key, {
      name: name.trim(),
      discordId: null,
      delivery: DEFAULT_DELIVERY,
      alerts: [...DEFAULT_ALERTS],
      subscribedAt: new Date(),
    });
    return true;
  }

  async remove(name: string): Promise<boolean> {
    return this.#byKey.delete(subscriberKey(name));
  }

  async has(name: string): Promise<boolean> {
    return this.#byKey.has(subscriberKey(name));
  }

  async get(name: string): Promise<Subscriber | null> {
    return this.#byKey.get(subscriberKey(name)) ?? null;
  }

  async update(name: string, changes: SubscriberUpdate): Promise<boolean> {
    const existing = this.#byKey.get(subscriberKey(name));
    if (!existing) return false;
    this.#byKey.set(subscriberKey(name), {
      ...existing,
      ...(changes.discordId !== undefined ? { discordId: changes.discordId } : {}),
      ...(changes.delivery !== undefined ? { delivery: changes.delivery } : {}),
      ...(changes.alerts !== undefined ? { alerts: [...changes.alerts] } : {}),
    });
    return true;
  }

  async all(): Promise<Subscriber[]> {
    return [...this.#byKey.values()];
  }

  async close(): Promise<void> {
    // nothing to release
  }
}
