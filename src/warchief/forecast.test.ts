import { describe, expect, it } from "vitest";
import {
  attributeDrops,
  DEFAULT_ATTRIBUTION_OPTIONS,
  evaluateForecast,
  blessingOutlook,
  coverageLookbackMs,
  coverageShare,
  lagSpread,
  watchedBefore,
  type FinishedRun,
  type ForecastEvaluation,
} from "./forecast.js";

const MIN = 60_000;

const run = (startMin: number, endMin: number, horde = 3): FinishedRun => ({
  startedAt: startMin * MIN,
  endedAt: endMin * MIN,
  horde,
  reason: "left",
  baseline: false,
});

const options = DEFAULT_ATTRIBUTION_OPTIONS; // Rend from 10m in, window 90m after leaving, Horde only
/** The watch saw everything. */
const sighted = (): boolean => false;

describe("attributeDrops", () => {
  it("puts a blessing down to the run that left shortly before it", () => {
    const r = run(0, 40);
    expect(attributeDrops([r], [55 * MIN], options)).toEqual([{ dropAt: 55 * MIN, run: r, lagMs: 15 * MIN }]);
  });

  it("puts a blessing that came while the run was inside down to it, with a negative lag", () => {
    const r = run(0, 40);
    expect(attributeDrops([r], [25 * MIN], options)[0]?.lagMs).toBe(-15 * MIN);
  });

  it("does not credit a run that had only just begun", () => {
    expect(attributeDrops([run(0, 40)], [5 * MIN], options)[0]?.run).toBeNull();
  });

  it("credits a run found already inside at once — it came in before we looked", () => {
    const found = { ...run(0, 3), baseline: true };
    expect(attributeDrops([found], [5 * MIN], options)[0]).toMatchObject({ run: found, lagMs: 2 * MIN });
  });

  it("leaves a blessing long after every run unexplained — a saved head", () => {
    expect(attributeDrops([run(0, 40)], [300 * MIN], options)[0]).toEqual({ dropAt: 300 * MIN, run: null, lagMs: null });
  });

  it("never credits a run without a Horde member, unless told to", () => {
    const alliance = run(0, 40, 0);
    expect(attributeDrops([alliance], [50 * MIN], options)[0]?.run).toBeNull();
    expect(attributeDrops([alliance], [50 * MIN], { ...options, requireHorde: false })[0]?.run).toBe(alliance);
  });

  it("credits each run with one blessing at most — a head drops once", () => {
    const r = run(0, 40);
    const [first, second] = attributeDrops([r], [50 * MIN, 60 * MIN], options);
    expect(first?.run).toBe(r);
    expect(second?.run).toBeNull();
  });

  it("chooses the run whose leaving is nearest the blessing", () => {
    const early = run(0, 30);
    const late = run(20, 70);
    expect(attributeDrops([early, late], [75 * MIN], options)[0]?.run).toBe(late);
  });

  it("takes the blessings in time order whatever order they come in", () => {
    const got = attributeDrops([run(0, 40)], [60 * MIN, 50 * MIN], options);
    expect(got.map((a) => a.dropAt)).toEqual([50 * MIN, 60 * MIN]);
  });
});

describe("evaluateForecast", () => {
  it("counts the blessings explained and the runs that led to one", () => {
    const runs = [run(0, 40), run(100, 140), run(300, 330, 0)];
    const drops = [50 * MIN, 1000 * MIN];
    const evaluation = evaluateForecast(runs, drops, options, 2000 * MIN, sighted);
    expect(evaluation).toMatchObject({ drops: 2, blind: 0, attributed: 1, midRun: 0, runs: 2, runsWithDrop: 1 });
    expect(evaluation.lag?.medianMs).toBe(10 * MIN);
  });

  it("does not yet count a run still inside its window as a miss", () => {
    const evaluation = evaluateForecast([run(0, 40)], [], options, 60 * MIN, sighted);
    expect(evaluation.runs).toBe(0);
  });

  it("counts the blessings that came mid-run", () => {
    const evaluation = evaluateForecast([run(0, 40)], [30 * MIN], options, 60 * MIN, sighted);
    expect(evaluation).toMatchObject({ attributed: 1, midRun: 1, runs: 1, runsWithDrop: 1 });
  });

  it("leaves out a miss the watch was blind to, counting it apart", () => {
    const blindLate = (dropAt: number): boolean => dropAt >= 90 * MIN;
    const evaluation = evaluateForecast([], [50 * MIN, 90 * MIN, 95 * MIN], options, 100 * MIN, blindLate);
    expect(evaluation).toMatchObject({ drops: 1, blind: 2, attributed: 0 });
  });

  it("still credits a run with a blessing it explains, however blind the watch was around it", () => {
    const evaluation = evaluateForecast([run(0, 40)], [50 * MIN], options, 200 * MIN, () => true);
    expect(evaluation).toMatchObject({ drops: 1, blind: 0, attributed: 1 });
  });
});

describe("lagSpread", () => {
  it("interpolates the quartiles of the lags", () => {
    expect(lagSpread([0, 10, 20, 30, 40])).toEqual({ p25Ms: 10, medianMs: 20, p75Ms: 30, p90Ms: 36 });
  });

  it("is null with nothing to spread", () => {
    expect(lagSpread([])).toBeNull();
  });
});

describe("blessingOutlook", () => {
  /** A score whose explained blessings came these many minutes after their runs left. */
  const scored = (lagMinutes: readonly number[]): ForecastEvaluation => ({
    drops: lagMinutes.length,
    blind: 0,
    attributed: lagMinutes.length,
    midRun: lagMinutes.filter((m) => m < 0).length,
    runs: lagMinutes.length,
    runsWithDrop: lagMinutes.length,
    lag: lagSpread(lagMinutes.map((m) => m * MIN)),
  });

  it("quotes the fallback until enough blessings have been explained", () => {
    expect(blessingOutlook(scored([5, 6]), 45 * MIN)).toEqual({ withinMs: 45 * MIN, learned: false });
  });

  it("learns the window most blessings land in, rounded up to five minutes", () => {
    expect(blessingOutlook(scored([2, 8, 11, 14, 21, 26, 40]), 45 * MIN)).toEqual({ withinMs: 25 * MIN, learned: true });
  });

  it("never quotes less than five minutes, even when blessings come mid-run", () => {
    expect(blessingOutlook(scored([-20, -10, -5, -3, -1]), 45 * MIN).withinMs).toBe(5 * MIN);
  });
});

describe("coverageShare", () => {
  const every = (fromMin: number, toMin: number, stepMin = 1): number[] =>
    Array.from({ length: Math.floor((toMin - fromMin) / stepMin) + 1 }, (_, i) => (fromMin + i * stepMin) * MIN);

  it("is whole when a reading came every minute", () => {
    expect(coverageShare(every(0, 60), 10 * MIN, 60 * MIN, 5 * MIN)).toBe(1);
  });

  it("counts a gap longer than the limit as blind past the limit", () => {
    // Readings to minute 20, none until minute 50: 20..25 vouched for, 25..50 blind.
    const readings = [...every(0, 20), ...every(50, 60)];
    expect(coverageShare(readings, 0, 60 * MIN, 5 * MIN)).toBeCloseTo(35 / 60);
  });

  it("is nothing before the first reading", () => {
    expect(coverageShare(every(30, 60), 0, 60 * MIN, 5 * MIN)).toBeCloseTo(30 / 60);
    expect(coverageShare([], 0, 60 * MIN, 5 * MIN)).toBe(0);
  });
});

describe("watchedBefore", () => {
  it("measures the readings over the window and the run before a blessing", () => {
    expect(coverageLookbackMs(options)).toBe(150 * MIN); // 90m window + an hour of run
    const readings = Array.from({ length: 301 }, (_, i) => i * MIN); // minutes 0..300
    expect(watchedBefore(readings, 200 * MIN, options, 5 * MIN)).toBe(1);
    expect(watchedBefore(readings, 100 * MIN, options, 5 * MIN)).toBeCloseTo(100 / 150);
    expect(watchedBefore(readings, 400 * MIN, options, 5 * MIN)).toBeCloseTo(55 / 150); // 250..305 of 250..400
  });
});
