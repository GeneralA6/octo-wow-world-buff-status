import { FACTIONS, type Faction } from "../watcher/buff-store.js";

/**
 * Persistence for who wants raid alerts, and how they want them delivered. The rest
 * of the bot depends only on this interface, so the Mongo-backed store and the
 * in-memory test fake are interchangeable. Character names are the identity (unique
 * per realm), matched case-insensitively; the display casing from subscribe is kept.
 */

export type { Faction };

/**
 * Where a subscriber is reached on a raid event:
 *   - "ingame"  — in-game whisper only, no Discord.
 *   - "both"    — in-game whisper AND a personal Discord ping, every time.
 *   - "offline" — in-game whisper; a Discord ping only when the character is offline.
 *   - "discord" — Discord DM only, no in-game whisper.
 * The Discord modes need a linked Discord id; "discord" with none linked reaches nobody.
 */
export type DeliveryMode = "ingame" | "both" | "offline" | "discord";

/**
 * Which alerts a subscriber wants (default: all). These are the ones whispered/DM'd:
 *   - "forming" — the early "a raid is forming" heads-up.
 *   - "cleared" — the "a raid just cleared, buff imminent" alert.
 * (The "buff is up" post always goes to the Discord channel, not per-subscriber.)
 */
export type AlertType = "forming" | "cleared";
export const ALL_ALERT_TYPES: readonly AlertType[] = ["forming", "cleared"];
export const DEFAULT_ALERTS: readonly AlertType[] = ALL_ALERT_TYPES;

export function isAlertType(value: string): value is AlertType {
  return ALL_ALERT_TYPES.some((type) => type === value);
}

/**
 * Which side(s) a subscriber wants alerts for — the Rallying Cry drops per capital
 * (Stormwind = alliance, Orgrimmar = horde), and a subscriber only cares about their
 * own. Defaults to BOTH until we learn their side (a `/who` at subscribe, or a manual
 * alliance/horde command), so nobody silently misses a buff.
 */
export const DEFAULT_FACTIONS: readonly Faction[] = FACTIONS;

export function isFaction(value: string): value is Faction {
  return FACTIONS.some((faction) => faction === value);
}

export interface Subscriber {
  readonly name: string;
  readonly discordId: string | null;
  readonly delivery: DeliveryMode;
  readonly alerts: readonly AlertType[];
  readonly factions: readonly Faction[];
  readonly subscribedAt: Date;
}

/** Fields a subscriber can change after subscribing. Omit a field to leave it. */
export interface SubscriberUpdate {
  readonly discordId?: string | null;
  readonly delivery?: DeliveryMode;
  readonly alerts?: readonly AlertType[];
  readonly factions?: readonly Faction[];
}

export interface SubscriberStore {
  /** Add a subscriber (delivery "both", no Discord id). True if newly added. */
  add(name: string): Promise<boolean>;
  /** Remove a subscriber. True if one was removed. */
  remove(name: string): Promise<boolean>;
  /** Remove every subscriber linked to a Discord id (unsubscribe from the Discord side).
   *  Returns the character names removed. */
  removeByDiscordId(discordId: string): Promise<string[]>;
  /** Every subscriber linked to a Discord id — for routing Discord DM commands to their
   *  character(s). Usually one; empty when the account has linked nothing. */
  findByDiscordId(discordId: string): Promise<Subscriber[]>;
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
