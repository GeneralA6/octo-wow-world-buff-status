import { describe, expect, it } from "vitest";
import { RaidCensus, summarizeDepartures } from "./raid-census.js";

const MIN = 60_000;

describe("RaidCensus", () => {
  it("records arrivals on first sight and not again", () => {
    const census = new RaidCensus();
    expect(census.observe(["A", "B"], 0).arrived).toEqual(["A", "B"]);
    expect(census.observe(["A", "B", "C"], MIN).arrived).toEqual(["C"]);
  });

  it("does not treat a single-poll blip as a departure (grace period)", () => {
    const census = new RaidCensus(120_000);
    census.observe(["A", "B"], 0);
    // B missing for one poll, then back — never crosses the grace window.
    expect(census.observe(["A"], MIN).departed).toEqual([]);
    const back = census.observe(["A", "B"], 2 * MIN);
    expect(back.departed).toEqual([]);
    expect(back.arrived).toEqual([]); // B kept its original firstSeen
  });

  it("reports a departure once a player is gone past the grace window, with how long they stayed", () => {
    const census = new RaidCensus(120_000);
    census.observe(["A", "B"], 0);
    census.observe(["A", "B"], 5 * MIN);
    census.observe(["A"], 6 * MIN); // B missing (60s < grace)
    const gone = census.observe(["A"], 9 * MIN); // B missing 4 min > grace
    expect(gone.departed).toHaveLength(1);
    expect(gone.departed[0]?.name).toBe("B");
    expect(gone.departed[0]?.stayedMs).toBe(5 * MIN); // last seen at 5min, first at 0
    expect(census.tracked).toBe(1);
  });

  it("reports the present count as the raw /who size", () => {
    const census = new RaidCensus();
    expect(census.observe(["A", "B", "C"], 0).present).toBe(3);
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
    expect(summary?.arrivalSpanMs).toBe(2 * MIN); // all arrived within 2 minutes
  });
});
