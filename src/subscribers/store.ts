/**
 * Persistence for who wants raid alerts, and how they want them delivered. The rest
 * of the bot depends only on this interface, so the Mongo-backed store and the
 * in-memory test fake are interchangeable. Character names are the identity (unique
 * per realm), matched case-insensitively; the display casing from subscribe is kept.
 */

/**
 * How a subscriber with a linked Discord id is reached on a raid event:
 *   - "both"    — in-game whisper AND a personal Discord ping, every time.
 *   - "offline" — in-game whisper; a Discord ping only when the character is offline.
 * With no linked Discord id, both modes behave the same (in-game only).
 */
export type DeliveryMode = "both" | "offline";

export interface Subscriber {
  readonly name: string;
  readonly discordId: string | null;
  readonly delivery: DeliveryMode;
  readonly subscribedAt: Date;
}

/** Fields a subscriber can change after subscribing. Omit a field to leave it. */
export interface SubscriberUpdate {
  readonly discordId?: string | null;
  readonly delivery?: DeliveryMode;
}

export interface SubscriberStore {
  /** Add a subscriber (delivery "both", no Discord id). True if newly added. */
  add(name: string): Promise<boolean>;
  /** Remove a subscriber. True if one was removed. */
  remove(name: string): Promise<boolean>;
  has(name: string): Promise<boolean>;
  get(name: string): Promise<Subscriber | null>;
  /** Apply changes to an existing subscriber. False if they aren't subscribed. */
  update(name: string, changes: SubscriberUpdate): Promise<boolean>;
  all(): Promise<Subscriber[]>;
  close(): Promise<void>;
}

export const DEFAULT_DELIVERY: DeliveryMode = "both";

/** Canonical case-insensitive key for a character name. */
export function subscriberKey(name: string): string {
  return name.trim().toLowerCase();
}
