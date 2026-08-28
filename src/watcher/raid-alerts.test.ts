import { describe, expect, it } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { OnyxiaWatcher } from "./onyxia-watcher.js";
import { raidAlerts } from "./raid-alerts.js";

const AREA = 2159;

/** N players in the watched zone, named p0..p(N-1). */
function crowd(size: number): WhoPlayer[] {
  return Array.from({ length: size }, (_, i) => ({
    name: `p${i}`,
    guild: "",
    level: 60,
    classId: 1,
    raceId: 1,
    areaId: AREA,
  }));
}

describe("raidAlerts", () => {
  it("stays silent below the raid-size floor", () => {
    const watcher = new OnyxiaWatcher();
    expect(raidAlerts(watcher, crowd(4), 5)).toEqual([]);
  });

  it("fires raid-entered once the floor is crossed", () => {
    const watcher = new OnyxiaWatcher();
    expect(raidAlerts(watcher, crowd(2), 5)).toEqual([]);
    const alerts = raidAlerts(watcher, crowd(5), 5);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe("raid-entered");
  });

  it("drops roster churn while a raid is inside", () => {
    const watcher = new OnyxiaWatcher();
    raidAlerts(watcher, crowd(10), 5); // entered
    // A member joins and another leaves — still a raid, nothing to say.
    const shifted: WhoPlayer[] = [...crowd(9), { ...crowd(1)[0]!, name: "newcomer" }];
    expect(raidAlerts(watcher, shifted, 5)).toEqual([]);
  });

  it("fires raid-left when the raid drops back under the floor", () => {
    const watcher = new OnyxiaWatcher();
    raidAlerts(watcher, crowd(20), 5); // entered
    const alerts = raidAlerts(watcher, crowd(3), 5); // stragglers below the floor
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe("raid-left");
  });

  it("reports an already-in-progress raid on the first poll", () => {
    const watcher = new OnyxiaWatcher();
    const alerts = raidAlerts(watcher, crowd(15), 5);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "raid-entered", initial: true });
  });

  it("does not re-alert while the raid stays above the floor", () => {
    const watcher = new OnyxiaWatcher();
    raidAlerts(watcher, crowd(10), 5); // entered
    expect(raidAlerts(watcher, crowd(10), 5)).toEqual([]);
  });
});
