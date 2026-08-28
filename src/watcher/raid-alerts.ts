import type { WhoPlayer } from "../protocol/who.js";
import { OnyxiaWatcher, type WatchEvent } from "./onyxia-watcher.js";

/** The events that earn a Discord ping — the two transitions a watcher cares about. */
export type RaidAlert =
  | Extract<WatchEvent, { kind: "raid-entered" }>
  | Extract<WatchEvent, { kind: "raid-left" }>;

/**
 * Fold one /who snapshot into the alerts it implies, applying the raid-size floor.
 *
 * A zone with fewer than `minRaidSize` players is treated as empty, so a lone scout
 * or a straggler or two never counts as a raid — the watcher only ever sees the lair
 * cross the "actually a raid" line. Roster churn while a raid is inside is dropped;
 * only a raid pulling in and the lair clearing come back.
 */
export function raidAlerts(
  watcher: OnyxiaWatcher,
  inZone: readonly WhoPlayer[],
  minRaidSize: number,
): RaidAlert[] {
  const raid = inZone.length >= minRaidSize ? inZone : [];
  const alerts: RaidAlert[] = [];
  for (const event of watcher.update(raid)) {
    if (event.kind === "raid-entered" || event.kind === "raid-left") alerts.push(event);
  }
  return alerts;
}
