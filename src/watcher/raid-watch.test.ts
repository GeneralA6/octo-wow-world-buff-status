import { describe, expect, it } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { RaidWatch } from "./raid-watch.js";

function raid(size: number, guild: string, raceId: number): WhoPlayer[] {
  return Array.from({ length: size }, (_, i) => ({
    name: `${guild}${i}`,
    guild,
    level: 60,
    classId: 1,
    raceId,
    areaId: 2159,
  }));
}

describe("RaidWatch", () => {
  it("reports a raid forming once the roster reaches the threshold", () => {
    const watch = new RaidWatch({ minRaidSize: 15, grouping: "auto", clearSize: 5, clearSustainedMs: 5 * 60_000 });
    const first = watch.observe(raid(16, "Nightfall", 1), 1_000, true);
    expect(first.countEvents.map((e) => e.kind)).toEqual(["raid-forming"]);
    expect(watch.activeRaids()).toHaveLength(1);
  });

  it("stays quiet below the threshold", () => {
    const watch = new RaidWatch({ minRaidSize: 15, grouping: "auto", clearSize: 5, clearSustainedMs: 5 * 60_000 });
    const obs = watch.observe(raid(8, "Horde", 2), 1_000, true);
    expect(obs.countEvents).toEqual([]);
    expect(watch.activeRaids()).toHaveLength(0);
  });

  it("absorbs a blackout without emitting events", () => {
    const watch = new RaidWatch({ minRaidSize: 15, grouping: "auto", clearSize: 5, clearSustainedMs: 5 * 60_000 });
    watch.observe(raid(16, "Nightfall", 1), 1_000, true);
    const after = watch.observe(raid(16, "Nightfall", 1), 1_000 + 20 * 60_000, true);
    expect(after.change.blackout).toBe(true);
    expect(after.countEvents).toEqual([]);
    expect(after.temporalEvents).toEqual([]);
    expect(after.clear).toBeNull();
  });

  it("surfaces a confirmed clear once the roster leaves and stays gone", () => {
    const watch = new RaidWatch({ minRaidSize: 15, grouping: "auto", clearSize: 5, clearSustainedMs: 5 * 60_000 });
    const t = 1_000;
    watch.observe(raid(20, "Nightfall", 1), t, true); // formed
    watch.observe([], t + 60_000, true); // everyone gone
    expect(watch.observe([], t + 4 * 60_000, true).clear).toBeNull(); // 4 min — a wipe could still run back
    const after = watch.observe([], t + 6 * 60_000, true); // 5 min+ sustained
    expect(after.clear).not.toBeNull();
    expect(after.clear?.peak).toBe(20);
  });

  it("reports how long the raid in progress has been in", () => {
    const watch = new RaidWatch({ minRaidSize: 15, grouping: "auto", clearSize: 5, clearSustainedMs: 5 * 60_000 });
    const t = 1_000;
    expect(watch.raidElapsedMs(t)).toBeNull();
    watch.observe(raid(20, "Nightfall", 1), t, true);
    expect(watch.raidElapsedMs(t + 5 * 60_000)).toBe(5 * 60_000);
  });

  it("numbers the raid in progress from the injected counter", () => {
    let n = 833;
    const watch = new RaidWatch({
      minRaidSize: 15,
      grouping: "auto",
      clearSize: 5,
      clearSustainedMs: 5 * 60_000,
      nextRaidNumber: () => ++n,
    });
    expect(watch.raidNumber()).toBeNull();
    watch.observe(raid(20, "Nightfall", 1), 1_000, true);
    expect(watch.raidNumber()).toBe(834);
  });

  describe("two-point start (forming early, clock at strength, leave below the floor)", () => {
    const opts = {
      minRaidSize: 20,
      strengthSize: 23,
      leftFloor: 15,
      grouping: "auto" as const,
      clearSize: 6,
      clearSustainedMs: 5 * 60_000,
    };

    const M = 60_000; // steps stay <= the 3-min blackout gap

    it("reports the formation only at strength, when the number exists — not at the forming size", () => {
      const watch = new RaidWatch(opts);
      const forming = watch.observe(raid(20, "Nightfall", 1), M, true);
      expect(forming.countEvents.map((e) => e.kind)).toEqual(["raid-forming"]); // detector event at 20
      expect(forming.formed).toBeNull(); // but no formation reported yet (< 23, no number)
      expect(watch.raidElapsedMs(M)).toBeNull(); // clock not started (< 23)
      const strong = watch.observe(raid(23, "Nightfall", 1), 2 * M, true); // reaches strength
      expect(watch.raidElapsedMs(2 * M)).toBe(0); // clock started here
      expect(strong.formed).not.toBeNull(); // and the "raid has formed" alert fires HERE
      expect(strong.formed?.peak).toBe(23);
    });

    it("does not read normal churn above the left floor as leaving", () => {
      const watch = new RaidWatch(opts);
      watch.observe(raid(25, "Nightfall", 1), M, true); // at strength
      // Dips to 18 (lost 7 to repairs/DCs) — above the 15 floor, so still present, no clear.
      watch.observe(raid(18, "Nightfall", 1), 2 * M, true);
      expect(watch.observe(raid(18, "Nightfall", 1), 3 * M, true).clear).toBeNull();
    });

    it("confirms a clear below the floor, timed from strength not forming", () => {
      const watch = new RaidWatch(opts);
      watch.observe(raid(20, "Nightfall", 1), 1 * M, true); // forming — clock NOT started
      watch.observe(raid(23, "Nightfall", 1), 2 * M, true); // strength — clock starts at 2M
      watch.observe(raid(10, "Nightfall", 1), 3 * M, true); // below 15 → belowSince = 3M
      watch.observe(raid(10, "Nightfall", 1), 5 * M, true); // 2 min gone, not yet sustained
      const after = watch.observe(raid(10, "Nightfall", 1), 8 * M, true); // 5 min sustained → clear
      expect(after.clear).not.toBeNull();
      // form→clear = belowSince(3M) − strength(2M) = 1M; from forming(1M) it would be 2M.
      expect(after.clear?.durationMs).toBe(1 * M);
    });
  });
});
