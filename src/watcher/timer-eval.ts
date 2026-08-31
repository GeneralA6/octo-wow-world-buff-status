import { medianOf } from "./duration-store.js";

/**
 * Self-evaluation of the learned raid-duration timer. The store already learns a median
 * clear time and predicts a forming raid's end from it; this scores how good that
 * prediction has BEEN, so the overnight logs can answer "is the timer any good?" without
 * anybody eyeballing raw durations.
 *
 * It replays history honestly: for each clear, it predicts from ONLY the clears that came
 * before it (an expanding-window median, the information the bot actually had at the time)
 * and compares to what happened. From those residuals:
 *
 *   - `maeMs`  — mean absolute error: typical miss, in either direction.
 *   - `biasMs` — mean signed error (actual − predicted). POSITIVE means raids run LONGER
 *     than predicted, so the park-alert fires early (people wait); NEGATIVE means they run
 *     short, so it fires late (people can miss the window) — the worse failure.
 *   - `p90ErrorMs` — the 90th-percentile miss, the tail a reader should size for.
 *
 * Pure over the chronological series, so it is unit-tested without a clock or a database.
 */
export interface TimerEvaluation {
  /** Total clears on record. */
  readonly samples: number;
  /** The current median estimate (ms), or null while still below `minSamples`. */
  readonly estimateMs: number | null;
  /** How many past clears were scored (those with at least `minSamples` priors). */
  readonly evaluated: number;
  /** Mean absolute prediction error (ms), or null if nothing was scored. */
  readonly maeMs: number | null;
  /** Mean signed error (ms): actual − predicted. Positive = raids run longer than predicted. */
  readonly biasMs: number | null;
  /** 90th-percentile absolute error (ms), or null if nothing was scored. */
  readonly p90ErrorMs: number | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The value at the given quantile (0..1) of the sorted absolute errors. */
function percentile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * @param seriesChrono clear durations (ms) in the order they happened, oldest first.
 * @param minSamples   the same floor the live estimate uses before it trusts the median.
 */
export function evaluateTimer(seriesChrono: readonly number[], minSamples: number): TimerEvaluation {
  const samples = seriesChrono.length;
  const estimateMs = samples >= minSamples ? medianOf(seriesChrono) : null;

  const abs: number[] = [];
  const signed: number[] = [];
  for (let i = Math.max(minSamples, 1); i < samples; i += 1) {
    const predicted = medianOf(seriesChrono.slice(0, i));
    if (predicted === null) continue;
    const error = seriesChrono[i]! - predicted;
    signed.push(error);
    abs.push(Math.abs(error));
  }

  const evaluated = abs.length;
  return {
    samples,
    estimateMs,
    evaluated,
    maeMs: evaluated ? mean(abs) : null,
    biasMs: evaluated ? mean(signed) : null,
    p90ErrorMs: evaluated ? percentile(abs, 0.9) : null,
  };
}
