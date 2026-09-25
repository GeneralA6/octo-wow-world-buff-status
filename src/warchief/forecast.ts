import type { SpireRunEndReason } from "./spire-runs.js";

/**
 * Scores the Spire runs against the Warchief's Blessings actually heard in Orgrimmar — the ground
 * truth the forecast is refined against — and learns from them how long after a run the blessing
 * comes.
 *
 * A blessing is put down to a run when it lands after Rend could have died (`minRendMs` into the run,
 * or at once for a run found already inside, whose real start we never saw) and no later than
 * `windowMs` after the run left; a run's head drops once, so each run explains at
 * most one blessing. Of the runs that could explain it, the one whose leaving is nearest in time is
 * chosen. Only a Horde player can turn the head in to Thrall, so a run with no Horde is no candidate
 * unless `requireHorde` is off — which is how a replay measures what that gate is worth.
 *
 * A blessing no run explains is a saved head (Rend killed hours or days before) or a run the tracker
 * missed; a run no blessing follows kept its head, turned it in on the far side of the window, or
 * was never a UBRS raid. Pure, so replays and tests share it with the live watch.
 */

/** A run that has ended, as the forecast scores it. */
export interface FinishedRun {
  readonly startedAt: number;
  readonly endedAt: number;
  /** How many of its roster were Horde. */
  readonly horde: number;
  readonly reason: SpireRunEndReason;
  readonly baseline: boolean;
}

export interface AttributionOptions {
  /** A blessing sooner than this after a run started cannot be that run's Rend. */
  readonly minRendMs: number;
  /** A blessing later than this after a run left is not put down to it. */
  readonly windowMs: number;
  /** Only runs with a Horde member can explain a blessing. */
  readonly requireHorde: boolean;
}

export const DEFAULT_ATTRIBUTION_OPTIONS: AttributionOptions = {
  minRendMs: 10 * 60_000,
  windowMs: 90 * 60_000,
  requireHorde: true,
};

/** A blessing and the run that explains it — or, for a saved head or a missed run, none. */
export type Attribution =
  | {
      readonly dropAt: number;
      readonly run: FinishedRun;
      /** Blessing time minus the run's leaving: negative when it dropped while the run was inside. */
      readonly lagMs: number;
    }
  | { readonly dropAt: number; readonly run: null; readonly lagMs: null };

/** Put each blessing down to the run that most plausibly dropped it. Both inputs in any order. */
export function attributeDrops(
  runs: readonly FinishedRun[],
  dropsAt: readonly number[],
  options: AttributionOptions,
): Attribution[] {
  const claimed = new Set<FinishedRun>();
  return [...dropsAt]
    .sort((a, b) => a - b)
    .map((dropAt) => {
      const run = runs
        .filter(
          (candidate) =>
            !claimed.has(candidate) &&
            (!options.requireHorde || candidate.horde > 0) &&
            // A run found already inside came in before we looked, so its Rend may already be down.
            dropAt >= candidate.startedAt + (candidate.baseline ? 0 : options.minRendMs) &&
            dropAt <= candidate.endedAt + options.windowMs,
        )
        .sort((a, b) => Math.abs(dropAt - a.endedAt) - Math.abs(dropAt - b.endedAt))[0];
      if (!run) return { dropAt, run: null, lagMs: null };
      claimed.add(run);
      return { dropAt, run, lagMs: dropAt - run.endedAt };
    });
}

export interface LagSpread {
  readonly p25Ms: number;
  readonly medianMs: number;
  readonly p75Ms: number;
  readonly p90Ms: number;
}

export interface ForecastEvaluation {
  /** Blessings scored — those the watch was looking for. */
  readonly drops: number;
  /** Blessings it was blind to, left out of the score: a run it could not see is no miss of its. */
  readonly blind: number;
  /** Blessings a run explains. */
  readonly attributed: number;
  /** ...of which dropped while the run was still inside. */
  readonly midRun: number;
  /** Candidate runs whose window has closed — the ones that had their chance to drop a blessing. */
  readonly runs: number;
  /** ...of which one did. */
  readonly runsWithDrop: number;
  /** Blessing time minus run leaving, over the explained blessings; null when there are none. */
  readonly lag: LagSpread | null;
}

/** The value at quantile `q` (0..1) of an ascending list, interpolated. */
function quantile(sorted: readonly number[], q: number): number {
  const index = (sorted.length - 1) * q;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}

export function lagSpread(lagsMs: readonly number[]): LagSpread | null {
  if (lagsMs.length === 0) return null;
  const sorted = [...lagsMs].sort((a, b) => a - b);
  return {
    p25Ms: quantile(sorted, 0.25),
    medianMs: quantile(sorted, 0.5),
    p75Ms: quantile(sorted, 0.75),
    p90Ms: quantile(sorted, 0.9),
  };
}

/**
 * How well the runs have foretold the blessings up to `now`. A blessing no run explains is a miss —
 * unless `blindAt` says the watch saw too little of the Spire before it to have caught the run, when
 * it is counted apart and left out: blindness excuses a miss, never a hit.
 */
export function evaluateForecast(
  runs: readonly FinishedRun[],
  dropsAt: readonly number[],
  options: AttributionOptions,
  now: number,
  blindAt: (dropAt: number) => boolean,
): ForecastEvaluation {
  const attributions = attributeDrops(runs, dropsAt, options);
  const blind = attributions.filter((a) => a.run === null && blindAt(a.dropAt)).length;
  const explained = attributions.flatMap((a) => (a.run === null ? [] : [{ run: a.run, lagMs: a.lagMs }]));
  const withDrop = new Set(explained.map((e) => e.run));
  // A run still inside its window may yet drop one; it is neither a hit nor a miss so far.
  const decided = runs.filter(
    (run) => (!options.requireHorde || run.horde > 0) && (withDrop.has(run) || run.endedAt + options.windowMs <= now),
  );
  return {
    drops: attributions.length - blind,
    blind,
    attributed: explained.length,
    midRun: explained.filter((e) => e.lagMs < 0).length,
    runs: decided.length,
    runsWithDrop: decided.filter((run) => withDrop.has(run)).length,
    lag: lagSpread(explained.map((e) => e.lagMs)),
  };
}

/**
 * Whether the watch saw enough of the Spire to be judged on a blessing: the share of the time a run
 * that could explain it was inside that the readings cover. Below it — the watch down, or its /who
 * going unanswered — a blessing no run explains says nothing about the forecast.
 */
export const MIN_COVERAGE = 0.9;

export function sawEnough(coverage: number): boolean {
  return coverage >= MIN_COVERAGE;
}

/** How long a run that could explain a blessing may have been inside: UBRS clears here in 30-40m
 *  (Chronicle's logs), so an hour allows a slow one. */
const RUN_SPAN_MS = 60 * 60_000;

/** How far back from a blessing the Spire must have been watched: the window after a run left, and
 *  the run itself before that. */
export function coverageLookbackMs(options: AttributionOptions): number {
  return options.windowMs + RUN_SPAN_MS;
}

/**
 * The share of [from, to] the readings cover. Each reading vouches for the time until the next one,
 * but no further than `maxGapMs` — past that the watch was blind. `readingTimes` ascending.
 */
export function coverageShare(readingTimes: readonly number[], from: number, to: number, maxGapMs: number): number {
  if (to <= from) return 1;
  let covered = 0;
  for (let i = 0; i < readingTimes.length; i += 1) {
    const start = readingTimes[i]!;
    const end = Math.min(readingTimes[i + 1] ?? start + maxGapMs, start + maxGapMs);
    const overlap = Math.min(end, to) - Math.max(start, from);
    if (overlap > 0) covered += overlap;
  }
  return covered / (to - from);
}

/** The share of the Spire the readings saw in the time a run that could explain a blessing at
 *  `dropAt` was inside. */
export function watchedBefore(
  readingTimes: readonly number[],
  dropAt: number,
  options: AttributionOptions,
  maxGapMs: number,
): number {
  return coverageShare(readingTimes, dropAt - coverageLookbackMs(options), dropAt, maxGapMs);
}

/** What a blessing heard says about the forecast. */
export type BlessingVerdict =
  /** The watch saw too little of the Spire to judge; `coverage` is the share it did see. */
  | { readonly kind: "blind"; readonly coverage: number }
  /** Put down to a finished run; `lagMs` is negative when it dropped before the run left. */
  | { readonly kind: "explained"; readonly run: FinishedRun; readonly lagMs: number }
  /** Dropped while a Horde run, in since `startedAt`, was still inside. */
  | { readonly kind: "mid-run"; readonly startedAt: number; readonly dropAt: number }
  /** Seen, but no run explains it: a saved head, or a run the tracker missed. */
  | { readonly kind: "unexplained" };

/** Below this many explained blessings the lag is anecdote, and the forecast quotes its fallback. */
export const MIN_LAGS_TO_LEARN = 5;

export interface BlessingOutlook {
  /** How long after a run leaves its blessing is expected. */
  readonly withinMs: number;
  /** Learned from the blessings explained so far, rather than the first guess. */
  readonly learned: boolean;
}

/**
 * How long after a run leaves its blessing should be expected: the 75th percentile of the lags the
 * score has seen, rounded up to the next five minutes, once enough blessings are explained — a
 * window most land inside without waiting on the slowest. `fallbackMs` until then.
 */
export function blessingOutlook(score: ForecastEvaluation, fallbackMs: number): BlessingOutlook {
  if (score.attributed < MIN_LAGS_TO_LEARN || score.lag === null) return { withinMs: fallbackMs, learned: false };
  const fiveMinutes = 5 * 60_000;
  return { withinMs: Math.max(fiveMinutes, Math.ceil(score.lag.p75Ms / fiveMinutes) * fiveMinutes), learned: true };
}
