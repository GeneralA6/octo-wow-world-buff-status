import { describe, expect, it } from "vitest";
import type { CensusChange, DepartedPlayer } from "./raid-census.js";
import { RaidSessions } from "./raid-sessions.js";

const MIN = 60_000;

function change(over: Partial<CensusChange>): CensusChange {
  return { now: 0, present: 0, arrived: [], departed: [], blackout: false, gapMs: MIN, ...over };
}

function names(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

/** A departure batch that arrived within `spanMs` and each stayed `stayMs`. */
function cluster(count: number, spanMs: number, stayMs: number): DepartedPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `d${i}`,
    firstSeen: Math.floor((spanMs * i) / Math.max(1, count - 1)),
    stayedMs: stayMs,
  }));
}

function make() {
  return new RaidSessions({ formAt: 15, formWindowMs: 20 * MIN, leaveClusterSize: 10, arrivalSpanMaxMs: 30 * MIN });
}

describe("RaidSessions (temporal detection)", () => {
  it("fires raid-forming when recent arrivals reach the threshold", () => {
    const s = make();
    expect(s.update(change({ now: 0, arrived: names("a", 8) }))).toEqual([]);
    const events = s.update(change({ now: MIN, arrived: names("b", 8) }));
    expect(events.map((e) => e.kind)).toEqual(["raid-forming"]);
    expect(events[0]?.cohort.count).toBe(16);
    expect(events[0]?.cohort.label).toBe("a raid");
  });

  it("does not re-fire while the same raid keeps growing (cooldown)", () => {
    const s = make();
    s.update(change({ now: 0, arrived: names("a", 16) })); // forms
    expect(s.update(change({ now: 2 * MIN, arrived: names("b", 20) }))).toEqual([]); // growth, still cooling down
  });

  it("ages stale arrivals out of the forming pool so a slow trickle isn't a raid", () => {
    const s = make();
    s.update(change({ now: 0, arrived: names("a", 8) }));
    // 25 min later, the first 8 have aged out; only these 8 are recent → no raid.
    expect(s.update(change({ now: 25 * MIN, arrived: names("b", 8) }))).toEqual([]);
  });

  it("fires raid-left for a departure cluster that arrived together", () => {
    const s = make();
    const events = s.update(change({ now: 45 * MIN, departed: cluster(12, 3 * MIN, 40 * MIN) }));
    expect(events.map((e) => e.kind)).toEqual(["raid-left"]);
    expect(events[0]?.cohort.peak).toBeGreaterThanOrEqual(12);
  });

  it("ignores a small departure or one spread across a wide arrival window", () => {
    expect(make().update(change({ departed: cluster(4, 3 * MIN, 40 * MIN) }))).toEqual([]); // too few
    expect(make().update(change({ departed: cluster(12, 90 * MIN, 40 * MIN) }))).toEqual([]); // arrived far apart
  });

  it("resets and stays silent on a blackout", () => {
    const s = make();
    s.update(change({ now: 0, arrived: names("a", 16) })); // forms
    expect(s.update(change({ now: 30 * MIN, blackout: true }))).toEqual([]);
    expect(s.activeRaids()).toEqual([]);
  });
});
