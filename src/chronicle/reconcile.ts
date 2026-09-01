import type { PollSnapshot } from "../watcher/snapshot-store.js";
import type { OnyxiaKill } from "./types.js";

/**
 * Cross-references Chronicle's clean Onyxia kills against our own /who roster history. A kill is
 * CONFIRMED when its uploader was in the lair (in one of our snapshots) around the kill's start —
 * i.e. it maps to a raid we detected. A kill whose uploader we never saw is one we MISSED. Pure:
 * kills + snapshots in, a partition out, so it's exhaustively unit-tested with no I/O.
 */

/**
 * Kills within this of each other count as one raid when tallying DISTINCT raids. Uploads of a
 * single raid share a start time to within a couple of minutes; this is a deliberately loose,
 * documented approximation (there is no participant list per log to dedup on precisely), and it
 * errs toward MERGING so the "missed raids" tally can't be inflated by duplicate uploads.
 */
export const RAID_CLUSTER_MS = 10 * 60_000;

export interface Reconciliation {
  /** Kills whose uploader we saw in the lair around the kill — raids our /who detected. */
  readonly confirmed: readonly OnyxiaKill[];
  /** Kills whose uploader we never saw around then — real kills we did not detect. */
  readonly missed: readonly OnyxiaKill[];
  /** Approximate distinct raids the kills represent (uploads collapsed by time). */
  readonly distinctRaids: number;
  /** Approximate distinct raids among the missed kills. */
  readonly distinctMissed: number;
}

/** Was this kill's uploader present in a /who roster within `windowMs` of the kill's start?
 *  Names are compared case-insensitively (WoW names are). */
export function isConfirmed(kill: OnyxiaKill, snapshots: readonly PollSnapshot[], windowMs: number): boolean {
  const lo = kill.at.getTime() - windowMs;
  const hi = kill.at.getTime() + windowMs;
  const uploader = kill.uploader.toLowerCase();
  for (const snap of snapshots) {
    const t = snap.ts.getTime();
    if (t < lo || t > hi) continue;
    if (snap.names.some((n) => n.toLowerCase() === uploader)) return true;
  }
  return false;
}

/** Distinct raids in a set of kills, collapsing any whose start times chain within `clusterMs`. */
export function countDistinctRaids(kills: readonly OnyxiaKill[], clusterMs: number): number {
  if (kills.length === 0) return 0;
  const times = kills.map((k) => k.at.getTime()).sort((a, b) => a - b);
  let clusters = 1;
  for (let i = 1; i < times.length; i++) {
    if (times[i]! - times[i - 1]! > clusterMs) clusters++;
  }
  return clusters;
}

export function reconcile(
  kills: readonly OnyxiaKill[],
  snapshots: readonly PollSnapshot[],
  windowMs: number,
): Reconciliation {
  const confirmed: OnyxiaKill[] = [];
  const missed: OnyxiaKill[] = [];
  for (const kill of kills) {
    (isConfirmed(kill, snapshots, windowMs) ? confirmed : missed).push(kill);
  }
  return {
    confirmed,
    missed,
    distinctRaids: countDistinctRaids(kills, RAID_CLUSTER_MS),
    distinctMissed: countDistinctRaids(missed, RAID_CLUSTER_MS),
  };
}
