/**
 * Persistence for who wants in-game whisper alerts. The rest of the bot depends
 * only on this interface, so the Mongo-backed store and the in-memory test fake
 * are interchangeable. Character names are the identity (unique per realm) and are
 * matched case-insensitively; the display casing from the first subscribe is kept.
 */

export interface Subscriber {
  readonly name: string;
  readonly subscribedAt: Date;
}

export interface SubscriberStore {
  /** Add a subscriber. Resolves true if newly added, false if already present. */
  add(name: string): Promise<boolean>;
  /** Remove a subscriber. Resolves true if one was removed. */
  remove(name: string): Promise<boolean>;
  has(name: string): Promise<boolean>;
  all(): Promise<Subscriber[]>;
  close(): Promise<void>;
}

/** Canonical case-insensitive key for a character name. */
export function subscriberKey(name: string): string {
  return name.trim().toLowerCase();
}
