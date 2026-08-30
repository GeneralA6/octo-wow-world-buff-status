/**
 * A compact one-line monitoring summary the watcher logs periodically, so the
 * numbers that otherwise live only in MongoDB — raid-duration samples, the learned
 * median clear-time vs the estimate actually in use, the subscriber count, and the
 * per-faction buff state — are visible in the deploy logs without any database
 * access. Pure formatting so it is unit-tested; the watcher gathers the stats and
 * calls this once per heartbeat.
 */

export interface HeartbeatBuff {
  readonly faction: string;
  /** Milliseconds until the active buff expires, or null when no buff is up. */
  readonly leftMs: number | null;
}

export interface HeartbeatStats {
  readonly subscribers: number;
  readonly samples: number;
  /** The learned median clear-time once >= minSamples are on record, else null. */
  readonly learnedMedianMs: number | null;
  readonly estimateMs: number;
  readonly minSamples: number;
  readonly buffs: readonly HeartbeatBuff[];
}

const mins = (ms: number): number => Math.round(ms / 60_000);

/** One log line: `monitor: 12 subs; raid timer learned median 43m (18 samples); buffs alliance up 74m left, horde clear`. */
export function formatHeartbeat(stats: HeartbeatStats): string {
  const timer =
    stats.learnedMedianMs !== null
      ? `learned median ${mins(stats.learnedMedianMs)}m (${stats.samples} samples)`
      : `${mins(stats.estimateMs)}m estimate (${stats.samples}/${stats.minSamples} to learn)`;
  const buffs =
    stats.buffs.length === 0
      ? "none tracked"
      : stats.buffs
          .map((b) => `${b.faction} ${b.leftMs === null ? "clear" : `up ${mins(b.leftMs)}m left`}`)
          .join(", ");
  return `monitor: ${stats.subscribers} subs; raid timer ${timer}; buffs ${buffs}`;
}
