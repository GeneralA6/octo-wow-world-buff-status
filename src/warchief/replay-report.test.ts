import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRIBUTION_OPTIONS } from "./forecast.js";
import { describeOptions, f1, parseReplayArgs, replayReport, sweepGrid } from "./replay-report.js";
import { DEFAULT_SPIRE_RUN_OPTIONS } from "./spire-runs.js";
import type { SpireSnapshot } from "./spire-snapshot-store.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 25, 20, 0);

/** Ten Orcs of <Warsong> in one a minute from minute 2, out at 45; one reading a minute to 200. */
function recorded(): SpireSnapshot[] {
  const out: SpireSnapshot[] = [];
  for (let minute = 0; minute <= 200; minute += 1) {
    const players = Array.from({ length: 10 }, (_, i) => i)
      .filter((i) => 2 + i <= minute && minute < 45)
      .map((i) => ({ name: `h${i}`, guild: "Warsong", level: 60, classId: 1, raceId: 2 }));
    out.push({ ts: new Date(T0 + minute * MIN), complete: true, players });
  }
  return out;
}

describe("parseReplayArgs", () => {
  it("replays a fortnight with the live thresholds by default", () => {
    expect(parseReplayArgs([])).toEqual({
      days: 14,
      tracker: DEFAULT_SPIRE_RUN_OPTIONS,
      attribution: DEFAULT_ATTRIBUTION_OPTIONS,
      sweep: false,
      runs: false,
      context: false,
    });
  });

  it("takes each threshold, times in minutes", () => {
    const args = parseReplayArgs([
      "--days", "30",
      "--min-level", "58",
      "--min-run-size", "7",
      "--link-gap", "8",
      "--join-gap", "12",
      "--max-run-size", "20",
      "--left-fraction", "0.25",
      "--end-sustained", "3",
      "--min-rend", "15",
      "--window", "60",
      "--any-faction",
      "--sweep",
      "--runs",
      "--context",
    ]);
    expect(args.days).toBe(30);
    expect(args.tracker).toMatchObject({
      minLevel: 58,
      minRunSize: 7,
      linkGapMs: 8 * MIN,
      joinGapMs: 12 * MIN,
      maxRunSize: 20,
      leftFraction: 0.25,
      endSustainedMs: 3 * MIN,
    });
    expect(args.attribution).toEqual({ minRendMs: 15 * MIN, windowMs: 60 * MIN, requireHorde: false });
    expect(args).toMatchObject({ sweep: true, runs: true, context: true });
  });

  it("refuses a malformed number", () => {
    expect(() => parseReplayArgs(["--min-run-size", "seven"])).toThrow(/--min-run-size must be a positive whole number/);
    expect(() => parseReplayArgs(["--days", "0"])).toThrow(/--days must be a positive whole number/);
    expect(() => parseReplayArgs(["--left-fraction", "1.5"])).toThrow(/--left-fraction must be below 1/);
    expect(() => parseReplayArgs(["--min-level", "0"])).toThrow(/--min-level must be a positive whole number/);
    expect(() => parseReplayArgs(["--min-level", "61"])).toThrow(/--min-level must be at most 60/);
  });

  it("refuses an option it does not know", () => {
    expect(() => parseReplayArgs(["--min-raid-size", "7"])).toThrow();
  });
});

describe("replayReport", () => {
  const args = parseReplayArgs([]);

  it("says so when there is nothing to replay", () => {
    expect(replayReport([], [], args)).toEqual(["No Spire readings in that span - is WOW_SPIRE_WATCH on, and has it run?"]);
  });

  it("heads the report with the span, the thresholds and the score", () => {
    const lines = replayReport(recorded(), [T0 + 60 * MIN], args);
    expect(lines[0]).toBe("Spire replay: 2026-09-25 20:00Z -> 2026-09-25 23:20Z, 201 readings, 1 blessings heard in that span");
    expect(lines[1]).toBe(describeOptions(args.tracker, args.attribution));
    expect(lines[2]).toMatch(/^Score: 1\/1 blessings explained/);
  });

  it("counts every blessing heard in the header, saying how many the watch was blind to", () => {
    const lines = replayReport(recorded(), [T0 + 6 * MIN, T0 + 60 * MIN], args);
    expect(lines[0]).toBe(
      "Spire replay: 2026-09-25 20:00Z -> 2026-09-25 23:20Z, 201 readings, 2 blessings heard in that span (1 while the watch was blind)",
    );
  });

  it("lists the runs and what each blessing was put down to", () => {
    const lines = replayReport(recorded(), [T0 + 6 * MIN, T0 + 60 * MIN, T0 + 190 * MIN], { ...args, runs: true });
    expect(lines).toContain("run 2026-09-25 20:02Z -> 20:45Z (43m) peak 10/10, 10 Horde, mostly <Warsong>, left");
    expect(lines).toContain("blessing 2026-09-25 20:06Z <- blind (the watch saw 4% of the Spire before it)");
    expect(lines).toContain("blessing 2026-09-25 21:00Z <- run from 20:02Z, 15m after it left");
    expect(lines).toContain("blessing 2026-09-25 23:10Z <- no run");
  });

  it("shows the headcount in the run-up to each blessing", () => {
    const lines = replayReport(recorded(), [T0 + 60 * MIN], { ...args, context: true });
    const at = lines.indexOf("blessing 2026-09-25 21:00Z - in the Spire (Horde) every 10m over the 3h before:");
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe("  -1h 0(0)  -50m 9(9)  -40m 10(10)  -30m 10(10)  -20m 10(10)  -10m 0(0)  0m 0(0)");
  });

  it("ranks the sweep, best first", () => {
    const lines = replayReport(recorded(), [T0 + 60 * MIN], { ...args, sweep: true });
    const at = lines.indexOf("Sweep, best first (F1 of blessings explained and runs that led to one):");
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toMatch(/^ {2}F1 1\.00 {2}Score: 1\/1/);
  });
});

describe("describeOptions", () => {
  it("names the minimum level only when one is set", () => {
    expect(describeOptions(DEFAULT_SPIRE_RUN_OPTIONS, DEFAULT_ATTRIBUTION_OPTIONS)).toMatch(/^runs: 8\+ in within 5m /);
    expect(describeOptions({ ...DEFAULT_SPIRE_RUN_OPTIONS, minLevel: 58 }, DEFAULT_ATTRIBUTION_OPTIONS)).toMatch(
      /^runs: 8\+ of level 58\+ in within 5m /,
    );
  });
});

describe("f1", () => {
  const evaluation = { drops: 10, blind: 0, attributed: 5, midRun: 0, runs: 10, runsWithDrop: 5, lag: null };

  it("balances blessings explained against runs that led to one", () => {
    expect(f1(evaluation)).toBeCloseTo(0.5);
    expect(f1({ ...evaluation, runs: 5 })).toBeCloseTo(2 / 3);
  });

  it("is zero with nothing to score", () => {
    expect(f1({ ...evaluation, drops: 0, attributed: 0, runs: 0, runsWithDrop: 0 })).toBe(0);
  });
});

describe("sweepGrid", () => {
  it("tries every combination of the main thresholds around the given ones", () => {
    const grid = sweepGrid(parseReplayArgs(["--any-faction"]));
    expect(grid).toHaveLength(5 * 3 * 3 * 3);
    expect(grid.every((options) => options.attribution.requireHorde === false)).toBe(true);
    expect(new Set(grid.map((o) => o.tracker.minRunSize))).toEqual(new Set([6, 7, 8, 9, 10]));
  });
});
