import { describe, expect, it } from "vitest";
import type { ForecastEvaluation } from "./forecast.js";
import { formatBlessingVerdict, formatRunEnded, formatRunStarted, formatScore, signedClock } from "./format.js";
import type { SpireRun } from "./spire-runs.js";

const MIN = 60_000;
const T0 = 1_790_000_000_000; // a whole second, so the Discord stamps below are exact
const stamp = (ms: number): string => `<t:${ms / 1000}:t>`;

const run = (overrides: Partial<SpireRun> = {}): SpireRun => ({
  id: 1,
  startedAt: T0,
  formedAt: T0 + 6 * MIN,
  roster: Array.from({ length: 10 }, (_, i) => ({
    name: `p${i}`,
    guild: i < 6 ? "Warsong" : "",
    level: 60,
    classId: 1,
    raceId: 2,
  })),
  peak: 10,
  baseline: false,
  ...overrides,
});

const score: ForecastEvaluation = {
  drops: 4,
  attributed: 3,
  midRun: 1,
  runs: 5,
  runsWithDrop: 3,
  lag: { p25Ms: -5 * MIN, medianMs: 12 * MIN, p75Ms: 20 * MIN, p90Ms: 31 * MIN },
};

describe("formatRunStarted", () => {
  it("says who came in, when, and that a blessing may follow", () => {
    const notice = formatRunStarted(run(), 4);
    expect(notice.title).toContain("shadow");
    expect(notice.body).toBe(
      `10 players (4 Horde, mostly <Warsong>) in together from ${stamp(T0)}. ` +
        "Rend can fall from ~10m in, and the blessing follows once a Horde member turns Rend's head in.",
    );
  });

  it("owns up to a run found already inside", () => {
    expect(formatRunStarted(run({ baseline: true }), 4).body).toContain(`already inside when we looked at ${stamp(T0 + 6 * MIN)}`);
  });

  it("names no guild that is not most of the run, and expects nothing without the Horde", () => {
    const pugs = run({ roster: run().roster.map((p, i) => ({ ...p, guild: i < 3 ? "Warsong" : "" })) });
    const body = formatRunStarted(pugs, 0).body;
    expect(body).toContain("10 players (0 Horde)");
    expect(body).toContain("no blessing can come of it");
  });
});

describe("formatRunEnded", () => {
  const firstGuess = { withinMs: 45 * MIN, learned: false };

  it("forecasts the blessing by the end of the window after the run left", () => {
    const body = formatRunEnded(run(), T0 + 38 * MIN, "left", 4, firstGuess).body;
    expect(body).toContain("left after 38m (peak 10)");
    expect(body).toContain(`should land by ~${stamp(T0 + 83 * MIN)}`);
    expect(body).toContain("a first guess of 45m");
  });

  it("quotes the learned window once there is one", () => {
    expect(formatRunEnded(run(), T0 + 38 * MIN, "left", 4, { withinMs: 25 * MIN, learned: true }).body).toContain(
      "most blessings have come within 25m of a run leaving",
    );
  });

  it("says a run lost across a gap was last seen at strength", () => {
    expect(formatRunEnded(run(), T0 + 20 * MIN, "blind", 4, firstGuess).body).toContain(
      `lost across a gap in our readings; last seen at strength ${stamp(T0 + 20 * MIN)}`,
    );
  });

  it("forecasts nothing for idlers", () => {
    const body = formatRunEnded(run(), T0 + 200 * MIN, "stale", 4, firstGuess).body;
    expect(body).toContain("still inside after 3h20m - idlers, not a raid. No forecast.");
  });
});

describe("formatBlessingVerdict", () => {
  const outlook = { withinMs: 25 * MIN, learned: true };
  const finished = { startedAt: T0, endedAt: T0 + 40 * MIN, horde: 4, reason: "left" as const, baseline: false };

  it("credits the run that left before it, inside or outside the window", () => {
    const inside = formatBlessingVerdict({ dropAt: T0 + 52 * MIN, run: finished, lagMs: 12 * MIN }, null, outlook, score);
    expect(inside.body.split("\n")[0]).toBe(`Came 12m after the run from ${stamp(T0)} left - inside the 25m window.`);
    const outside = formatBlessingVerdict({ dropAt: T0 + 80 * MIN, run: finished, lagMs: 40 * MIN }, null, outlook, score);
    expect(outside.body).toContain("outside the 25m window");
  });

  it("says when it came mid-run", () => {
    const verdict = formatBlessingVerdict({ dropAt: T0 + 25 * MIN, run: null, lagMs: null }, run(), outlook, score);
    expect(verdict.body).toContain(`Dropped 25m into the run still inside (from ${stamp(T0)}).`);
  });

  it("owns up to a blessing no run explains, and carries the score", () => {
    const verdict = formatBlessingVerdict({ dropAt: T0, run: null, lagMs: null }, null, outlook, score);
    expect(verdict.body).toBe(`No Spire run explains it - a saved head, or a run the watch missed.\n${formatScore(score)}`);
  });
});

describe("formatScore", () => {
  it("puts the record and the lag spread in one line", () => {
    expect(formatScore(score)).toBe(
      "Score: 3/4 blessings explained by a Spire run (1 mid-run), 3/5 Horde runs led to one; " +
        "run-left-to-blessing median 12m (p25 -5m, p75 20m, p90 31m).",
    );
  });

  it("leaves the spread off before anything is explained", () => {
    expect(formatScore({ ...score, attributed: 0, midRun: 0, lag: null })).toBe(
      "Score: 0/4 blessings explained by a Spire run (0 mid-run), 3/5 Horde runs led to one.",
    );
  });
});

describe("signedClock", () => {
  it("keeps the sign humanClock would clamp away", () => {
    expect(signedClock(-12 * MIN)).toBe("-12m");
    expect(signedClock(90 * MIN)).toBe("1h30m");
  });
});
