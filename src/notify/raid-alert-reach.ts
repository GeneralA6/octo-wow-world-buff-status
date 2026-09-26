import type { RaidEvent } from "../watcher/raid-events.js";

/**
 * How far each raid alert reaches. Every one is posted to the Discord channel and whispered to the
 * subscribers — the start too: left out for a while, a raid then went by with no word before its
 * clear, and the clear came after the head was already turned in.
 *
 * Only the clear is yelled. It is the one that means a head exists — the buff most often follows
 * within the half hour — and the one a player already standing in the city can act on, by staying.
 * A GM asked that the city hear the bot once per raid.
 */

/** Every raid alert the service sends. */
export type RaidAlertKind = RaidEvent["kind"] | "raid-ending" | "raid-disbanded";

/**
 * Whether a buff drop is whispered to the subscribers. A drop they were told was coming — a raid
 * cleared — is, closing the loop for whoever waited in the city. A saved head is not: nothing led up
 * to it, the buff reaches only those already standing there, and a whisper minutes later would only
 * tell everyone else they missed it. Its Discord post stays, saying it was a saved head.
 */
export function isDropWhispered(savedHead: boolean): boolean {
  return !savedHead;
}

/** Whether `kind` is yelled in the capitals as well. */
export function yelledInCapitals(kind: RaidAlertKind): boolean {
  return kind === "raid-left";
}
