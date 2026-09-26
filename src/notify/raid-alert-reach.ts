import type { RaidEvent } from "../watcher/raid-events.js";

/**
 * How far each raid alert reaches: whether it is sent at all — the Discord channel post and the
 * subscribers' whispers — and whether it is also yelled in the capitals.
 *
 * Measured over a week of raids, the start was the weakest: most raids that form see no buff within
 * the hour — a third never clear, and after a clear the head is as often kept as turned in — so it is
 * not sent, for now. "Might end soon" is the first word of a raid instead, sent early enough to act on.
 *
 * Only the clear is yelled. It is the one that means a head exists — the buff most often follows
 * within the half hour — and the one a player already standing in the city can act on, by staying.
 * A GM asked that the city hear the bot once per raid.
 */

/** Every raid alert the service sends. */
export type RaidAlertKind = RaidEvent["kind"] | "raid-ending" | "raid-disbanded";

/** Whether `kind` is sent at all: posted to the Discord channel and whispered to the subscribers. */
export function isAnnounced(kind: RaidAlertKind): boolean {
  return kind !== "raid-forming";
}

/** Whether `kind` is yelled in the capitals as well. */
export function yelledInCapitals(kind: RaidAlertKind): boolean {
  return kind === "raid-left";
}
