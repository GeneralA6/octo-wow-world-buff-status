import { describe, expect, it } from "vitest";
import { RaidCensus, summarizeDepartures } from "./raid-census.js";

const MIN = 60_000;
const GRACE = 120_000;
const NO_BLACKOUT = 3_600_000; // 1h — high so ordinary gaps in these tests never trip it

describe("RaidCensus", () => {
  it("records arrivals on first sight and not again", () => {
    const census = new RaidCensus(GRACE, NO_BLACKOUT);
    expect(census.observe(["A", "B"], 0).arrived).toEqual(["A", "B"]);
    expect(census.observe(["A", "B", "C"], MIN).arrived).toEqual(["C"]);
  });

  it("does not treat a single-poll blip as a departure (grace period)", () => {
    const census = new RaidCensus(GRACE, NO_BLACKOUT);
    census.observe(["A", "B"], 0);
    expect(census.observe(["A"], MIN).departed).toEqual([]);
    const back = census.observe(["A", "B"], 2 * MIN);
    expect(back.departed).toEqual([]);
    expect(back.arrived).toEqual([]); // B kept its original firstSeen
  });

  it("reports a departure once a player is gone past the grace window, with how long they stayed", () => {
    const census = new RaidCensus(GRACE, NO_BLACKOUT);
    census.observe(["A", "B"], 0);
    census.observe(["A", "B"], 2 * MIN); // both present, lastSeen = 2m
    census.observe(["A"], 3 * MIN); // B missing 1m (< grace)
    const gone = census.observe(["A"], 5 * MIN); // B missing 3m (> grace)
    expect(gone.departed).toHaveLength(1);
    expect(gone.departed[0]?.name).toBe("B");
    expect(gone.departed[0]?.stayedMs).toBe(2 * MIN);
    expect(census.tracked).toBe(1);
  });

  it("reports the present count as the raw /who size", () => {
    const census = new RaidCensus(GRACE, NO_BLACKOUT);
    expect(census.observe(["A", "B", "C"], 0).present).toBe(3);
  });

  it("re-baselines after a long blind gap instead of a fake mass-departure", () => {
    const census = new RaidCensus(GRACE, 180_000);
    census.observe(["A", "B", "C"], 0);
    // A 5-minute blackout (server was down); different players are here on return.
    const change = census.observe(["X", "Y"], 5 * MIN);
    expect(change.blackout).toBe(true);
    expect(change.departed).toEqual([]); // no fake mass-departure
    expect(change.arrived).toEqual([]); // a reset, not arrivals
    expect(census.tracked).toBe(2);
    // The next normal poll works off the fresh baseline.
    expect(census.observe(["X", "Y", "Z"], 6 * MIN).arrived).toEqual(["Z"]);
  });

  it("does not blackout on a normal-length gap", () => {
    const census = new RaidCensus(GRACE, 180_000);
    census.observe(["A"], 0);
    expect(census.observe(["A"], MIN).blackout).toBe(false);
  });
});

describe("summarizeDepartures", () => {
  it("returns null for an empty batch", () => {
    expect(summarizeDepartures([])).toBeNull();
  });

  it("captures the shape of a raid leaving together — similar stays, tight arrival span", () => {
    const departed = [
      { name: "a", firstSeen: 0, stayedMs: 40 * MIN },
      { name: "b", firstSeen: 2 * MIN, stayedMs: 41 * MIN },
      { name: "c", firstSeen: 1 * MIN, stayedMs: 42 * MIN },
    ];
    const summary = summarizeDepartures(departed);
    expect(summary).toMatchObject({ count: 3, minStayMs: 40 * MIN, maxStayMs: 42 * MIN });
    expect(summary?.medianStayMs).toBe(41 * MIN);
    expect(summary?.arrivalSpanMs).toBe(2 * MIN);
  });
});
