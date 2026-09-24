import { describe, expect, it } from "vitest";
import {
  attributeDrops,
  DEFAULT_ATTRIBUTION_OPTIONS,
  evaluateForecast,
  expectedWithinMs,
  lagSpread,
  type FinishedRun,
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
    const evaluation = evaluateForecast(runs, drops, options, 2000 * MIN);
    expect(evaluation).toMatchObject({ drops: 2, attributed: 1, midRun: 0, runs: 2, runsWithDrop: 1 });
    expect(evaluation.lag?.medianMs).toBe(10 * MIN);
  });

  it("does not yet count a run still inside its window as a miss", () => {
    const evaluation = evaluateForecast([run(0, 40)], [], options, 60 * MIN);
    expect(evaluation.runs).toBe(0);
  });

  it("counts the blessings that came mid-run", () => {
    const evaluation = evaluateForecast([run(0, 40)], [30 * MIN], options, 60 * MIN);
    expect(evaluation).toMatchObject({ attributed: 1, midRun: 1, runs: 1, runsWithDrop: 1 });
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

describe("expectedWithinMs", () => {
  it("quotes the fallback until enough blessings have been explained", () => {
    expect(expectedWithinMs([5 * MIN, 6 * MIN], 45 * MIN)).toBe(45 * MIN);
  });

  it("learns the window most blessings land in, rounded up to five minutes", () => {
    const lags = [2, 8, 11, 14, 21, 26, 40].map((m) => m * MIN);
    expect(expectedWithinMs(lags, 45 * MIN)).toBe(25 * MIN); // p75 = 23.5m
  });

  it("never quotes less than five minutes, even when blessings come mid-run", () => {
    expect(expectedWithinMs([-20, -10, -5, -3, -1].map((m) => m * MIN), 45 * MIN)).toBe(5 * MIN);
  });
});
