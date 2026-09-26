import type { RaidEvent } from "../watcher/raid-events.js";

/**
 * Which raid alerts are also yelled in the capitals — every one still reaches the subscribers by
 * whisper and the Discord channel.
 *
 * Only the clear. It is the one that means a head exists — the buff most often follows within the
 * half hour — and the one a player already standing in the city can act on, by staying. A GM asked
 * that the city hear the bot once per raid, so the start, "might end soon" and a disband are not
 * yelled.
 */

/** Every raid alert the service sends. */
export type RaidAlertKind = RaidEvent["kind"] | "raid-ending" | "raid-disbanded";

/** Whether `kind` is yelled in the capitals as well. */
export function yelledInCapitals(kind: RaidAlertKind): boolean {
  return kind === "raid-left";
}
