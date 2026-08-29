import { describe, expect, it } from "vitest";
import { RaidCensus } from "./raid-census.js";

/**
 * Adversarial tests — these demonstrate how the current name+timing census FAILS on
 * real WoW /who behaviour. They assert the (wrong) current behaviour so the failures
 * are explicit and measurable; the redesign must make the correct behaviour hold.
 */

const MIN = 60_000;
const NO_BLACKOUT = 3_600_000;

/** A rolling window of `size` names out of `all`, offset by `start` (a re-sorting /who). */
function window(all: string[], start: number, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < size; i++) out.push(all[(start + i) % all.length]!);
  return out;
}

describe("ATTACK: the 49-result /who cap", () => {
  it("reports phantom departures for players who never actually left the lair", () => {
    const census = new RaidCensus(120_000, NO_BLACKOUT);
    // 55 players are really in the lair the whole time, but /who returns 49. After a
    // re-sort, p0..p5 fall outside the visible 49 and STAY out — still in the lair.
    const all = Array.from({ length: 55 }, (_, i) => `p${i}`);
    census.observe(window(all, 0, 49), 0); // baseline: p0..p48 visible
    const shifted = window(all, 6, 49); // p6..p54 visible; p0..p5 now hidden
    census.observe(shifted, MIN);
    census.observe(shifted, 2 * MIN);
    const c = census.observe(shifted, 3 * MIN); // p0..p5 absent 180s > grace → evicted here
    // p0..p5 never left — but a stable cap exclusion makes them "depart".
    expect(c.departed.length).toBe(6);
  });

  it("cannot tell a real departure from a cap eviction near the cap", () => {
    const census = new RaidCensus(120_000, NO_BLACKOUT);
    const all = Array.from({ length: 60 }, (_, i) => `p${i}`);
    // Steady near-cap churn produces a stream of arrived/departed even in a static lair.
    census.observe(window(all, 0, 49), 0);
    const c = census.observe(window(all, 20, 49), MIN);
    expect(c.arrived.length + c.departed.length).toBeGreaterThan(0); // pure noise, no real change
  });
});

describe("ATTACK: partial / flaky /who", () => {
  it("evicts a whole present raid if /who under-reports for a couple of polls", () => {
    const census = new RaidCensus(120_000, NO_BLACKOUT);
    const raid = Array.from({ length: 25 }, (_, i) => `r${i}`);
    census.observe(raid, 0);
    census.observe(raid, MIN);
    // The raid is STILL there, but /who returns only a few (server load / partial result)
    // for three polls — longer than the grace window.
    census.observe(raid.slice(0, 3), 2 * MIN);
    census.observe(raid.slice(0, 3), 3 * MIN);
    const c = census.observe(raid.slice(0, 3), 4 * MIN);
    // 22 players "left" — a fake mass departure that would fire a fake "raid left".
    expect(c.departed.length).toBe(22);
  });
});

describe("ATTACK: duration integrity", () => {
  it("assigns a fabricated short stay to players who were already there at baseline", () => {
    const census = new RaidCensus(120_000, NO_BLACKOUT);
    // 15 players are ALREADY mid-raid when the bot boots — their true firstSeen is
    // an hour ago, but the census stamps firstSeen = boot.
    const raid = Array.from({ length: 15 }, (_, i) => `r${i}`);
    census.observe(raid, 0); // boot baseline
    census.observe(raid, 5 * MIN);
    census.observe([], 6 * MIN);
    census.observe([], 7 * MIN);
    const gone = census.observe([], 8 * MIN);
    // Reports ~5 min stays — there is no flag marking these as "arrival never observed",
    // so this garbage would poison the duration median.
    expect(gone.departed.every((d) => d.stayedMs <= 5 * MIN)).toBe(true);
    expect(gone.departed).toHaveLength(15);
  });
});
