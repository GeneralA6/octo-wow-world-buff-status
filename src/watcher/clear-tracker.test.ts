import { describe, expect, it } from "vitest";
import { ClearTracker } from "./clear-tracker.js";

const MIN = 60_000;
/** `n` roster members r0..r(n-1); a smaller n is a subset (a wipe trough of the same raid). */
const R = (n: number): string[] => Array.from({ length: n }, (_, i) => `r${i}`);
/** `n` DIFFERENT people c0..c(n-1) — a new crowd / ambient traffic. */
const C = (n: number): string[] => Array.from({ length: n }, (_, i) => `c${i}`);

function tracker() {
  return new ClearTracker({ formAt: 15, sustainedMs: 5 * MIN });
}

describe("ClearTracker", () => {
  it("does not track until the zone reaches raid strength", () => {
    const t = tracker();
    expect(t.observe(R(10), 0, false)).toBeNull();
    expect(t.tracking).toBe(false);
    expect(t.observe(R(15), MIN, false)).toBeNull();
    expect(t.tracking).toBe(true);
  });

  it("TOLERATES a wipe — the same members drop out and run back inside the window", () => {
    const t = tracker();
    t.observe(R(30), 0, false); // formed
    expect(t.observe(R(6), 2 * MIN, false)).toBeNull(); // wipe: only 6 of the roster visible
    expect(t.observe(R(9), 4 * MIN, false)).toBeNull(); // still low, still inside 5 min
    expect(t.observe(R(30), 5 * MIN, false)).toBeNull(); // same members ran back → recovered
    expect(t.tracking).toBe(true); // still the same raid
  });

  it("CONFIRMS a clear when the roster leaves and stays gone past the window", () => {
    const t = tracker();
    t.observe(R(30), 0, false); // formed at 0
    // ...raid runs, then everyone leaves at 40 min and does not come back
    t.observe(R(30), 40 * MIN, false);
    expect(t.observe(R(2), 41 * MIN, false)).toBeNull(); // departure begins
    expect(t.observe(R(0), 45 * MIN, false)).toBeNull(); // 4 min in — not yet
    const clear = t.observe(R(0), 46 * MIN, false); // 5 min sustained
    expect(clear).not.toBeNull();
    expect(clear?.durationMs).toBe(41 * MIN); // form(0) → departure start(41m), spanning nothing here
    expect(t.tracking).toBe(false); // reset, ready for the next raid
  });

  it("spans wipes: the duration runs from form through every wipe to the final departure", () => {
    const t = tracker();
    t.observe(R(30), 0, false);
    t.observe(R(5), 10 * MIN, false); // wipe
    t.observe(R(30), 12 * MIN, false); // back
    t.observe(R(4), 30 * MIN, false); // wipe
    t.observe(R(30), 33 * MIN, false); // back
    t.observe(R(1), 50 * MIN, false); // real departure begins at 50m
    const clear = t.observe(R(0), 56 * MIN, false); // sustained 6 min
    expect(clear?.durationMs).toBe(50 * MIN); // 0 → 50m, wipes absorbed
  });

  it("a DIFFERENT crowd arriving does NOT keep the old raid alive (roster sync)", () => {
    const t = tracker();
    t.observe(R(30), 0, false); // raid r0..r29
    // the raid leaves; 20 unrelated players are now in the lair
    t.observe(C(20), 20 * MIN, false); // cohort of the OLD roster = 0
    const clear = t.observe(C(20), 26 * MIN, false); // old roster gone 6 min → clear
    expect(clear?.durationMs).toBe(20 * MIN);
  });

  it("a blackout DISCARDS the in-progress measurement (no false instant clear on a mass DC)", () => {
    const t = tracker();
    t.observe(R(30), 0, false);
    t.observe(R(4), 10 * MIN, false); // everyone drops...
    expect(t.observe([], 11 * MIN, true)).toBeNull(); // ...but it's a blackout (server/us offline)
    expect(t.tracking).toBe(false); // discarded, not recorded as a clear
  });

  it("sizes the raid by the plateau peak, not a wipe trough", () => {
    const t = tracker();
    t.observe(R(20), 0, false); // peak 20
    t.observe(R(34), 2 * MIN, false); // grew
    t.observe(R(34), 3 * MIN, false); // roster caught up → peak 34
    t.observe(R(5), 20 * MIN, false); // wipe trough (not the peak)
    const clear = t.observe(R(0), 26 * MIN, false);
    expect(clear?.peak).toBe(34);
  });

  it("forms a fresh raid after a clear, timed from the NEW formation", () => {
    const t = tracker();
    t.observe(R(30), 0, false);
    t.observe(R(0), 10 * MIN, false);
    expect(t.observe(R(0), 16 * MIN, false)).not.toBeNull(); // first raid cleared at 16m
    expect(t.tracking).toBe(false);
    // a new, different raid forms at 30m and later clears
    t.observe(C(20), 30 * MIN, false);
    expect(t.tracking).toBe(true);
    t.observe(C(1), 50 * MIN, false); // departs
    const clear = t.observe(C(0), 56 * MIN, false); // sustained 6 min
    expect(clear?.durationMs).toBe(20 * MIN); // 30m → 50m, proving the fresh formedAt
  });
});
