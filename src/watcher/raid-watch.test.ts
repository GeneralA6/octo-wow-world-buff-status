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
});
