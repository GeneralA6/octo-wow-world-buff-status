import { describe, expect, it } from "vitest";
import { evaluateTimer } from "./timer-eval.js";

const M = 60_000; // one minute in ms

describe("evaluateTimer", () => {
  it("reports no estimate and nothing scored below the sample floor", () => {
    const evaln = evaluateTimer([40 * M, 50 * M], 5);
    expect(evaln.samples).toBe(2);
    expect(evaln.estimateMs).toBeNull();
    expect(evaln.evaluated).toBe(0);
    expect(evaln.maeMs).toBeNull();
    expect(evaln.biasMs).toBeNull();
  });

  it("gives the median estimate once the floor is met", () => {
    const evaln = evaluateTimer([40 * M, 45 * M, 50 * M], 3);
    expect(evaln.estimateMs).toBe(45 * M);
  });

  it("scores a perfectly steady series as zero error and zero bias", () => {
    const evaln = evaluateTimer(Array(10).fill(45 * M), 3);
    expect(evaln.evaluated).toBe(7); // indices 3..9
    expect(evaln.maeMs).toBe(0);
    expect(evaln.biasMs).toBe(0);
    expect(evaln.p90ErrorMs).toBe(0);
  });

  it("reports positive bias when raids run longer than the prior median predicted", () => {
    // Steady 40m, then a run of 60m clears — actual exceeds the predicted median.
    const series = [40 * M, 40 * M, 40 * M, 60 * M, 60 * M, 60 * M];
    const evaln = evaluateTimer(series, 3);
    expect(evaln.biasMs).not.toBeNull();
    expect(evaln.biasMs!).toBeGreaterThan(0);
    expect(evaln.maeMs!).toBeGreaterThan(0);
  });

  it("reports negative bias when raids run shorter than predicted (the worse miss)", () => {
    const series = [60 * M, 60 * M, 60 * M, 40 * M, 40 * M, 40 * M];
    const evaln = evaluateTimer(series, 3);
    expect(evaln.biasMs!).toBeLessThan(0);
  });

  it("computes MAE from the honest expanding-window prediction", () => {
    // priors before index 3 are [40,40,40] → predicted 40; actual 46 → error 6m.
    // Only one scored point (minSamples 3, series length 4).
    const evaln = evaluateTimer([40 * M, 40 * M, 40 * M, 46 * M], 3);
    expect(evaln.evaluated).toBe(1);
    expect(evaln.maeMs).toBe(6 * M);
    expect(evaln.biasMs).toBe(6 * M);
  });
});
