import { describe, expect, it } from "vitest";
import type { Arrival, Departure, PresenceChange } from "./presence.js";
import { RaidSessions } from "./raid-sessions.js";

const MIN = 60_000;

function change(over: Partial<PresenceChange>): PresenceChange {
  return {
    now: 0,
    present: 0,
    complete: true,
    blackout: false,
    gapMs: MIN,
    arrivals: [],
    departures: [],
    ...over,
  };
}

function arrivals(prefix: string, n: number): Arrival[] {
  return Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, arrivalObserved: true }));
}

/** A confident departure batch that arrived within `spanMs` and each stayed `stayMs`. */
function cluster(count: number, spanMs: number, stayMs: number, confident = true): Departure[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `d${i}`,
    firstSeen: Math.floor((spanMs * i) / Math.max(1, count - 1)),
    stayedMs: stayMs,
    confident,
    stayKnown: true,
  }));
}

function make() {
  return new RaidSessions({ formAt: 15, formWindowMs: 20 * MIN, leaveClusterSize: 10, arrivalSpanMaxMs: 30 * MIN });
}

describe("RaidSessions (temporal detection)", () => {
  it("fires raid-forming when recent arrivals reach the threshold", () => {
    const s = make();
    expect(s.update(change({ now: 0, arrivals: arrivals("a", 8) }))).toEqual([]);
    const events = s.update(change({ now: MIN, arrivals: arrivals("b", 8) }));
    expect(events.map((e) => e.kind)).toEqual(["raid-forming"]);
    expect(events[0]?.cohort.count).toBe(16);
  });

  it("does not re-fire while the same raid keeps growing (cooldown)", () => {
    const s = make();
    s.update(change({ now: 0, arrivals: arrivals("a", 16) }));
    expect(s.update(change({ now: 2 * MIN, arrivals: arrivals("b", 20) }))).toEqual([]);
  });

  it("ages stale arrivals out of the forming pool so a slow trickle isn't a raid", () => {
    const s = make();
    s.update(change({ now: 0, arrivals: arrivals("a", 8) }));
    expect(s.update(change({ now: 25 * MIN, arrivals: arrivals("b", 8) }))).toEqual([]);
  });

  it("fires raid-left for a confident departure cluster that arrived together", () => {
    const s = make();
    const events = s.update(change({ now: 45 * MIN, departures: cluster(12, 3 * MIN, 40 * MIN) }));
    expect(events.map((e) => e.kind)).toEqual(["raid-left"]);
    expect(events[0]?.cohort.peak).toBeGreaterThanOrEqual(12);
  });

  it("reports the form→clear duration on raid-left when it saw the raid form", () => {
    const s = make();
    s.update(change({ now: 0, arrivals: arrivals("a", 16) })); // forms, formedAt = 0
    const events = s.update(change({ now: 50 * MIN, departures: cluster(12, 3 * MIN, 45 * MIN) }));
    const e = events[0];
    expect(e?.kind).toBe("raid-left");
    if (e?.kind === "raid-left") expect(e.durationMs).toBe(50 * MIN);
  });

  it("ignores a small departure, a spread-out one, or a NON-confident cluster", () => {
    expect(make().update(change({ departures: cluster(4, 3 * MIN, 40 * MIN) }))).toEqual([]); // too few
    expect(make().update(change({ departures: cluster(12, 90 * MIN, 40 * MIN) }))).toEqual([]); // arrived far apart
    expect(make().update(change({ departures: cluster(12, 3 * MIN, 40 * MIN, false) }))).toEqual([]); // truncation, not real
  });

  it("resets and stays silent on a blackout", () => {
    const s = make();
    s.update(change({ now: 0, arrivals: arrivals("a", 16) }));
    expect(s.update(change({ now: 30 * MIN, blackout: true }))).toEqual([]);
    expect(s.activeRaids()).toEqual([]);
  });
});
