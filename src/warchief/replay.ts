import { factionOfRace } from "../watcher/faction.js";
import { dominantGuild } from "../watcher/raid-events.js";
import {
  attributeDrops,
  evaluateForecast,
  type Attribution,
  type AttributionOptions,
  type FinishedRun,
  type ForecastEvaluation,
} from "./forecast.js";
import type { SpireSnapshot } from "./spire-snapshot-store.js";
import { hordeMembers, SpireRunTracker, type SpireRunOptions } from "./spire-runs.js";

/**
 * Replays recorded Blackrock Spire readings through the run tracker and scores the runs it finds
 * against the blessings heard — the loop the forecast is refined in: change a threshold, replay the
 * same history, compare the score. Pure, so the CLI (replay-cli.ts) only loads the data and prints.
 */

export interface ReplayOptions {
  readonly tracker: SpireRunOptions;
  readonly attribution: AttributionOptions;
}

/** A finished run as the replay reports it: what the forecast scores, plus what a reader needs. */
export interface ReplayRun extends FinishedRun {
  readonly size: number;
  readonly peak: number;
  readonly guild: string | null;
}

export interface ReplayResult {
  readonly runs: readonly ReplayRun[];
  readonly attributions: readonly Attribution[];
  readonly evaluation: ForecastEvaluation;
  /** The readings' span; blessings outside it are left out, as the watch was not looking. */
  readonly from: number;
  readonly to: number;
}

export function replaySpire(
  snapshots: readonly SpireSnapshot[],
  blessingsAt: readonly number[],
  options: ReplayOptions,
): ReplayResult | null {
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  if (!first || !last) return null;
  const tracker = new SpireRunTracker(options.tracker);
  const runs: ReplayRun[] = [];
  for (const snapshot of snapshots) {
    for (const event of tracker.observe({ present: snapshot.players, complete: snapshot.complete, at: snapshot.ts.getTime() })) {
      if (event.kind !== "run-ended" || event.reason === "stale") continue;
      runs.push({
        startedAt: event.run.startedAt,
        endedAt: event.endedAt,
        horde: hordeMembers(event.run.roster),
        reason: event.reason,
        baseline: event.run.baseline,
        size: event.run.roster.length,
        peak: event.run.peak,
        guild: dominantGuild(event.run.roster)?.guild ?? null,
      });
    }
  }
  const from = first.ts.getTime();
  const to = last.ts.getTime();
  const drops = blessingsAt.filter((t) => t >= from && t <= to);
  return {
    runs,
    attributions: attributeDrops(runs, drops, options.attribution),
    evaluation: evaluateForecast(runs, drops, options.attribution, to),
    from,
    to,
  };
}

export interface Occupancy {
  /** How long before the moment asked about this reading was taken. */
  readonly beforeMs: number;
  readonly present: number;
  readonly horde: number;
}

/**
 * Who was in the Spire in the run-up to a moment — the latest reading at or before each step back
 * from `at` — so a blessing can be looked at against the raw headcount, not only the tracker's runs.
 * A step with no reading at or before it (before the watch began) is left out.
 */
export function occupancyBefore(
  snapshots: readonly SpireSnapshot[],
  at: number,
  spanMs: number,
  stepMs: number,
): Occupancy[] {
  const out: Occupancy[] = [];
  for (let beforeMs = spanMs; beforeMs >= 0; beforeMs -= stepMs) {
    const t = at - beforeMs;
    let reading: SpireSnapshot | undefined;
    for (const snapshot of snapshots) {
      if (snapshot.ts.getTime() > t) break;
      reading = snapshot;
    }
    if (!reading) continue;
    out.push({
      beforeMs,
      present: reading.players.length,
      horde: reading.players.filter((p) => factionOfRace(p.raceId) === "horde").length,
    });
  }
  return out;
}
