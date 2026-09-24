import { describe, expect, it, vi } from "vitest";
import { InMemoryBuffStore } from "./buff-store.js";
import { WarchiefBlessingTracker } from "./warchief-tracker.js";

const heard = (detectedBy: string) => ({ sourceName: "Thrall", text: "Be bathed in my power!", detectedBy });

function setup() {
  const store = new InMemoryBuffStore();
  const logger = { info: vi.fn(), error: vi.fn() };
  const tracker = new WarchiefBlessingTracker({ store, dedupWindowMs: 5 * 60_000, logger });
  return { store, logger, tracker };
}

describe("WarchiefBlessingTracker", () => {
  it("records a drop and hands it back to announce", async () => {
    const { store, tracker } = setup();
    expect(tracker.record(heard("Onyxiabuffog"), 1_000)).toEqual(new Date(1_000));
    await Promise.resolve();
    expect((await store.current("horde"))?.appliedAt).toEqual(new Date(1_000));
  });

  it("folds the second listener's echo, and Thrall's second yell, into the same drop", () => {
    const { tracker, logger } = setup();
    expect(tracker.record(heard("Onyxiabuffog"), 1_000)).not.toBeNull();
    expect(tracker.record(heard("Onybuffogb"), 1_200)).toBeNull();
    expect(tracker.record(heard("Onyxiabuffog"), 4_000)).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      "warchief's blessing: already recorded moments ago — ignoring the echo heard by Onybuffogb",
    );
  });

  it("records a later turn-in as a new drop", () => {
    const { tracker } = setup();
    tracker.record(heard("Onyxiabuffog"), 0);
    expect(tracker.record(heard("Onyxiabuffog"), 3 * 60 * 60_000)).not.toBeNull();
  });

  it("says how long ago the last drop was, or null before any", async () => {
    const { tracker } = setup();
    expect(await tracker.lastDropAgo(10_000)).toBeNull();
    tracker.record(heard("Onyxiabuffog"), 10_000);
    await Promise.resolve();
    expect(await tracker.lastDropAgo(10_000 + 95 * 60_000)).toBe(95 * 60_000);
  });
});
