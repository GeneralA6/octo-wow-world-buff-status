import { describe, expect, it, vi } from "vitest";
import { BuffTracker, type BuffTrackerDeps } from "./buff-tracker.js";
import { InMemoryBuffStore } from "./buff-store.js";
import { newLairActivity, noteLairPoll, type LairActivity } from "./drop-origin.js";

const MIN = 60_000;
const meta = { sourceName: "Someguildie", text: "Rallying Cry of the Dragonslayer!", detectedBy: "Onybuffog" };

function harness(over: Partial<BuffTrackerDeps> = {}) {
  const store = new InMemoryBuffStore();
  const activity: LairActivity = over.activity ?? newLairActivity();
  const logger = { info: vi.fn(), error: vi.fn() };
  const deps: BuffTrackerDeps = {
    store,
    dedupWindowMs: 10 * MIN,
    freshWindowMs: 15 * MIN,
    cooldownMs: 0,
    activity,
    logger,
    ...over,
  };
  return { tracker: new BuffTracker(deps), store, activity, logger };
}

describe("BuffTracker.record", () => {
  it("records a fresh kill when a raid was in the lair within the window, and persists it", async () => {
    const { tracker, store, activity } = harness();
    noteLairPoll(activity, 25, 1_000); // a raid is present
    const drop = tracker.record("alliance", meta, 2_000);
    expect(drop).toEqual({ appliedAt: new Date(2_000), origin: "fresh" });
    expect(await store.current("alliance")).toEqual({ faction: "alliance", appliedAt: new Date(2_000) });
  });

  it("classifies a drop over an empty (fully-observed) lair as a saved head", () => {
    const { tracker, activity } = harness();
    noteLairPoll(activity, 0, 1_000); // full coverage, nobody in the lair
    expect(tracker.record("horde", meta, 2_000)?.origin).toBe("saved");
  });

  it("classifies a drop as unknown when the lair was never polled (blind)", () => {
    const { tracker } = harness();
    expect(tracker.record("horde", meta, 2_000)?.origin).toBe("unknown");
  });

  it("ignores a duplicate heard by a second listener within the dedup window", () => {
    const { tracker, logger } = harness();
    expect(tracker.record("alliance", meta, 1_000)).not.toBeNull();
    expect(tracker.record("alliance", { ...meta, detectedBy: "Onybuffsw" }, 1_000 + 30_000)).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("ignoring duplicate heard by Onybuffsw"));
  });

  it("lets the SAME faction drop again once the dedup window has passed", () => {
    const { tracker } = harness({ dedupWindowMs: 5 * MIN });
    expect(tracker.record("alliance", meta, 0)).not.toBeNull();
    expect(tracker.record("alliance", meta, 6 * MIN)).not.toBeNull(); // a genuinely later drop
  });

  it("dedups per faction — alliance and horde don't shadow each other", () => {
    const { tracker } = harness();
    expect(tracker.record("alliance", meta, 1_000)).not.toBeNull();
    expect(tracker.record("horde", meta, 1_000)).not.toBeNull();
  });
});

describe("BuffTracker state (for the policy + status)", () => {
  it("reports the last drop time per faction", async () => {
    const { tracker } = harness();
    expect(await tracker.lastDropAt("alliance")).toBeNull();
    tracker.record("alliance", meta, 5_000);
    expect(await tracker.lastDropAt("alliance")).toEqual(new Date(5_000));
    expect(await tracker.lastDropAt("horde")).toBeNull();
  });

  it("reports cooldown remaining when a cooldown is configured and active", async () => {
    const { tracker } = harness({ cooldownMs: 60 * MIN });
    tracker.record("horde", meta, 10 * MIN);
    const state = await tracker.cooldownState("horde", 12 * MIN); // 2m since a 60m cooldown drop
    expect(state).toEqual({ faction: "horde", sinceLastDropMs: 2 * MIN, cooldownRemainingMs: 58 * MIN });
  });

  it("reports zero cooldown remaining when no cooldown is configured", async () => {
    const { tracker } = harness({ cooldownMs: 0 });
    tracker.record("horde", meta, 10 * MIN);
    const state = await tracker.cooldownState("horde", 12 * MIN);
    expect(state.cooldownRemainingMs).toBe(0);
    expect(state.sinceLastDropMs).toBe(2 * MIN);
  });

  it("exposes the drop history for interval measurement", async () => {
    const { tracker } = harness({ dedupWindowMs: 1 });
    tracker.record("alliance", meta, 1_000);
    tracker.record("alliance", meta, 2_000);
    expect((await tracker.history("alliance", 5)).map((d) => d.appliedAt)).toEqual([new Date(1_000), new Date(2_000)]);
  });
});
