import { describe, expect, it } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { FactionWatch } from "./faction-watch.js";

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

describe("FactionWatch", () => {
  it("reports a raid forming once its slice reaches the threshold", () => {
    const watch = new FactionWatch("alliance", { minRaidSize: 15, grouping: "auto", clearSize: 5 });
    const first = watch.observe(raid(16, "Nightfall", 1), 1_000, true);
    expect(first.countEvents.map((e) => e.kind)).toEqual(["raid-forming"]);
    expect(watch.activeRaids()).toHaveLength(1);
  });

  it("stays quiet below the threshold", () => {
    const watch = new FactionWatch("horde", { minRaidSize: 15, grouping: "auto", clearSize: 5 });
    const obs = watch.observe(raid(8, "Horde", 2), 1_000, true);
    expect(obs.countEvents).toEqual([]);
    expect(watch.activeRaids()).toHaveLength(0);
  });

  it("absorbs a blackout without emitting events", () => {
    const watch = new FactionWatch("alliance", { minRaidSize: 15, grouping: "auto", clearSize: 5 });
    watch.observe(raid(16, "Nightfall", 1), 1_000, true);
    // A gap far beyond the blackout window → re-baseline, no events.
    const after = watch.observe(raid(16, "Nightfall", 1), 1_000 + 20 * 60_000, true);
    expect(after.change.blackout).toBe(true);
    expect(after.countEvents).toEqual([]);
    expect(after.temporalEvents).toEqual([]);
  });
});
