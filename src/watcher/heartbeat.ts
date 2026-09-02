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

/** How well the learned timer has predicted past clears — the self-evaluation segment. */
export interface HeartbeatAccuracy {
  /** How many past clears were scored. */
  readonly evaluated: number;
  /** Mean absolute prediction error (ms). */
  readonly maeMs: number;
  /** Mean signed error (ms): positive = raids ran longer than predicted (alert fires early). */
  readonly biasMs: number;
}

export interface HeartbeatStats {
  readonly subscribers: number;
  /** Distinct people who have EVER subscribed (survives unsubscribing). Omitted = not shown. */
  readonly totalUsers?: number;
  /** Distinct people ever guild-invited (lifetime). Omitted = not shown. */
  readonly totalInvites?: number;
  /** Bot-invited players currently in the guild (active). Shown beside the invite total. */
  readonly activeGuildies?: number;
  readonly samples: number;
  /** The learned median clear-time once >= minSamples are on record, else null. */
  readonly learnedMedianMs: number | null;
  /** The bias-corrected estimate actually used by the live timer, else null. Shown next to the
   *  median when the correction moved it, so the log says what the timer is really predicting. */
  readonly improvedMs?: number | null;
  readonly estimateMs: number;
  readonly minSamples: number;
  readonly buffs: readonly HeartbeatBuff[];
  /** Timer self-evaluation, appended when at least one past clear has been scored. */
  readonly accuracy?: HeartbeatAccuracy | null;
}

const mins = (ms: number): number => Math.round(ms / 60_000);
const signedMins = (ms: number): string => `${ms >= 0 ? "+" : "-"}${Math.abs(mins(ms))}m`;

/** One log line: `monitor: 12 subs; raid timer learned median 43m (18 samples); accuracy MAE 6m bias +2m over 15; buffs alliance up 74m left, horde clear`. */
export function formatHeartbeat(stats: HeartbeatStats): string {
  // When the bias correction actually moved the estimate, show both: the raw median and the
  // number the timer now uses. When it didn't (or isn't available), just the median.
  const corrected =
    stats.improvedMs != null && stats.learnedMedianMs !== null && stats.improvedMs !== stats.learnedMedianMs
      ? ` -> uses ${mins(stats.improvedMs)}m`
      : "";
  const timer =
    stats.learnedMedianMs !== null
      ? `learned median ${mins(stats.learnedMedianMs)}m${corrected} (${stats.samples} samples)`
      : `${mins(stats.estimateMs)}m estimate (${stats.samples}/${stats.minSamples} to learn)`;
  const accuracy =
    stats.accuracy && stats.accuracy.evaluated > 0
      ? `; accuracy MAE ${mins(stats.accuracy.maeMs)}m bias ${signedMins(stats.accuracy.biasMs)} over ${stats.accuracy.evaluated}`
      : "";
  const buffs =
    stats.buffs.length === 0
      ? "none tracked"
      : stats.buffs
          .map((b) => `${b.faction} ${b.leftMs === null ? "clear" : `up ${mins(b.leftMs)}m left`}`)
          .join(", ");
  const subs =
    stats.totalUsers != null
      ? `${stats.subscribers} subs (${stats.totalUsers} all-time)`
      : `${stats.subscribers} subs`;
  const invites =
    stats.totalInvites != null
      ? `; ${stats.totalInvites} invites all-time${stats.activeGuildies != null ? ` (${stats.activeGuildies} in guild)` : ""}`
      : "";
  return `monitor: ${subs}${invites}; raid timer ${timer}${accuracy}; buffs ${buffs}`;
}
