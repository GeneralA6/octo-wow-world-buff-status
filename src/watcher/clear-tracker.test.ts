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

  it("assigns a reference number at form, exposes it, and carries it on the clear", () => {
    let n = 40;
    const t = new ClearTracker({ formAt: 15, sustainedMs: 5 * MIN, nextNumber: () => ++n });
    expect(t.number).toBeNull();
    t.observe(R(20), 0, false); // forms → #41
    expect(t.number).toBe(41);
    t.observe(R(0), 10 * MIN, false);
    const clear = t.observe(R(0), 16 * MIN, false);
    expect(clear?.number).toBe(41);
    expect(t.number).toBeNull(); // reset
    t.observe(C(20), 30 * MIN, false); // next raid → #42
    expect(t.number).toBe(42);
  });

  it("leaves raids unnumbered when no counter is configured", () => {
    const t = tracker();
    t.observe(R(20), 0, false);
    expect(t.number).toBeNull();
    t.observe(R(0), 10 * MIN, false);
    expect(t.observe(R(0), 16 * MIN, false)?.number).toBeNull();
  });

  it("snapshots a raid and RESUMES it after a restart, still catching the clear", () => {
    const a = tracker();
    a.observe(R(30), 0, false); // forms
    a.observe(R(30), 20 * MIN, false); // running
    const snap = a.snapshot();
    expect(snap).not.toBeNull();

    // A fresh tracker (simulating a restart) resumes from the snapshot.
    const b = tracker();
    expect(b.tracking).toBe(false);
    b.restore(snap!);
    expect(b.tracking).toBe(true);
    expect(b.elapsedMs(20 * MIN)).toBe(20 * MIN); // same form time

    // The raid leaves and stays gone — the resumed tracker confirms the clear.
    b.observe(R(0), 40 * MIN, false);
    const clear = b.observe(R(0), 46 * MIN, false);
    expect(clear?.durationMs).toBe(40 * MIN); // 0 → 40m, spanning the restart
  });

  it("snapshot is null when no raid is tracked, and restore is ignored mid-raid", () => {
    const t = tracker();
    expect(t.snapshot()).toBeNull();
    t.observe(R(30), 0, false);
    const other: import("./clear-tracker.js").ClearTrackerState = {
      formedAt: 999,
      number: 5,
      roster: ["x"],
      peak: 99,
      belowSince: null,
    };
    t.restore(other); // ignored — already tracking
    expect(t.elapsedMs(10 * MIN)).toBe(10 * MIN); // kept its own form time (0), not 999
  });

  it("reports elapsed time from form, and null when not tracking", () => {
    const t = tracker();
    expect(t.elapsedMs(5 * MIN)).toBeNull();
    t.observe(R(20), 1 * MIN, false);
    expect(t.elapsedMs(10 * MIN)).toBe(9 * MIN); // form at 1m → 9m elapsed at 10m
    t.observe(R(0), 20 * MIN, false);
    t.observe(R(0), 26 * MIN, false); // clears
    expect(t.elapsedMs(30 * MIN)).toBeNull(); // reset
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

describe("ClearTracker pending() / confirmNow() — Chronicle early-confirm", () => {
  it("reports no pending departure while a raid is present or none is tracked", () => {
    const t = tracker();
    expect(t.pending()).toBeNull(); // nothing tracked
    t.observe(R(30), 0, false); // formed, present
    expect(t.pending()).toBeNull(); // present, roster not below the floor
  });

  it("reports a pending departure once the roster drops below the floor, with the roster", () => {
    const t = tracker();
    t.observe(R(30), 0, false);
    t.observe(R(1), 40 * MIN, false); // departure begins at 40m
    const p = t.pending();
    expect(p).not.toBeNull();
    expect(p?.belowSince).toBe(40 * MIN);
    expect(p?.formedAt).toBe(0);
    expect(p?.peak).toBe(30);
    expect(p?.roster).toContain("r0"); // the raid's members, to match a Chronicle uploader against
  });

  it("confirmNow() ends a pending departure early with the same clear the wait would give", () => {
    const t = tracker();
    t.observe(R(30), 0, false);
    t.observe(R(1), 40 * MIN, false); // departure begins — normally 5 more min of waiting
    const clear = t.confirmNow(); // Chronicle proved the kill — confirm at 41m, not 45m
    expect(clear).not.toBeNull();
    expect(clear?.durationMs).toBe(40 * MIN); // form(0) → departure start(40m), same as the sustained path
    expect(clear?.peak).toBe(30);
    expect(t.tracking).toBe(false); // reset, exactly as a sustained clear leaves it
    expect(t.pending()).toBeNull();
  });

  it("confirmNow() manufactures nothing without a detected departure (present raid, or none)", () => {
    const t = tracker();
    expect(t.confirmNow()).toBeNull(); // nothing tracked
    t.observe(R(30), 0, false); // formed, present, roster NOT below the floor
    expect(t.confirmNow()).toBeNull(); // no departure detected → no clear
    expect(t.tracking).toBe(true); // and it did not disturb the tracked raid
  });
});
