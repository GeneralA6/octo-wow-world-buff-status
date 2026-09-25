import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRIBUTION_OPTIONS } from "./forecast.js";
import { occupancyBefore, replaySpire } from "./replay.js";
import { DEFAULT_SPIRE_RUN_OPTIONS } from "./spire-runs.js";
import type { SpireSnapshot } from "./spire-snapshot-store.js";
import type { SpirePlayer } from "./spire-view.js";

const MIN = 60_000;
const T0 = 1_790_000_000_000;
const ORC = 2;
const HUMAN = 1;

const player = (name: string, raceId: number, guild = ""): SpirePlayer => ({ name, guild, level: 60, classId: 1, raceId });

interface Stay {
  readonly player: SpirePlayer;
  readonly from: number;
  readonly to: number;
}

const raid = (prefix: string, from: number, to: number, raceId = ORC, guild = ""): Stay[] =>
  Array.from({ length: 10 }, (_, i) => ({ player: player(`${prefix}${i}`, raceId, guild), from: from + i, to }));

/** A reading a minute over [start, end] (minutes after T0). */
function recorded(stays: readonly Stay[], start: number, end: number): SpireSnapshot[] {
  const out: SpireSnapshot[] = [];
  for (let minute = start; minute <= end; minute += 1) {
    const players = stays.filter((s) => s.from <= minute && minute < s.to).map((s) => s.player);
    out.push({ ts: new Date(T0 + minute * MIN), complete: true, players });
  }
  return out;
}

const options = { tracker: DEFAULT_SPIRE_RUN_OPTIONS, attribution: DEFAULT_ATTRIBUTION_OPTIONS };

describe("replaySpire", () => {
  it("finds the runs in the recorded readings and scores them against the blessings", () => {
    const snapshots = recorded([...raid("h", 2, 45, ORC, "Warsong"), ...raid("a", 100, 140, HUMAN)], 0, 200);
    const result = replaySpire(snapshots, [T0 + 60 * MIN], options);
    expect(result?.runs.map((r) => ({ horde: r.horde, size: r.size, guild: r.guild }))).toEqual([
      { horde: 10, size: 10, guild: "Warsong" },
      { horde: 0, size: 10, guild: null },
    ]);
    expect(result?.attributions[0]?.lagMs).toBe(15 * MIN);
    expect(result?.evaluation).toMatchObject({ drops: 1, attributed: 1, runs: 1, runsWithDrop: 1 });
  });

  it("leaves out blessings from outside the readings' span", () => {
    const result = replaySpire(recorded([], 0, 200), [T0 - 5 * MIN, T0 + 180 * MIN, T0 + 220 * MIN], options);
    expect(result?.evaluation).toMatchObject({ drops: 1, blind: 0 });
    expect(result).toMatchObject({ from: T0, to: T0 + 200 * MIN });
  });

  it("does not fault the forecast for a blessing it was too blind to see coming", () => {
    // Readings only from minute 0; a blessing ten minutes in could be a run that came and went unseen.
    const result = replaySpire(recorded([], 0, 200), [T0 + 10 * MIN, T0 + 180 * MIN], options);
    expect(result?.evaluation).toMatchObject({ drops: 1, blind: 1, attributed: 0 });
    expect(result?.blind.map((b) => b.dropAt)).toEqual([T0 + 10 * MIN]);
    expect(result?.blind[0]?.coverage).toBeCloseTo(10 / 150);
  });

  it("takes the tracker's thresholds from the options — the knob a replay turns", () => {
    const snapshots = recorded(raid("h", 2, 45), 0, 60);
    const strict = { ...options, tracker: { ...DEFAULT_SPIRE_RUN_OPTIONS, minRunSize: 12 } };
    expect(replaySpire(snapshots, [], strict)?.runs).toEqual([]);
  });

  it("has nothing to say without readings", () => {
    expect(replaySpire([], [T0], options)).toBeNull();
  });
});

describe("occupancyBefore", () => {
  it("reads the headcount and the Horde among it at each step back", () => {
    const snapshots = recorded([...raid("h", 0, 30), ...raid("a", 0, 60, HUMAN)], 0, 60);
    expect(occupancyBefore(snapshots, T0 + 60 * MIN, 40 * MIN, 20 * MIN)).toEqual([
      { beforeMs: 40 * MIN, present: 20, horde: 10 },
      { beforeMs: 20 * MIN, present: 10, horde: 0 },
      { beforeMs: 0, present: 0, horde: 0 },
    ]);
  });

  it("skips the steps from before the first reading", () => {
    const snapshots = recorded([], 10, 20);
    expect(occupancyBefore(snapshots, T0 + 20 * MIN, 20 * MIN, 10 * MIN).map((o) => o.beforeMs)).toEqual([
      10 * MIN,
      0,
    ]);
  });
});
