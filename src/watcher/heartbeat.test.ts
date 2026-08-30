import { describe, expect, it } from "vitest";
import { formatHeartbeat, type HeartbeatStats } from "./heartbeat.js";

const base: HeartbeatStats = {
  subscribers: 0,
  samples: 0,
  learnedMedianMs: null,
  estimateMs: 45 * 60_000,
  minSamples: 15,
  buffs: [],
};

describe("formatHeartbeat", () => {
  it("shows the estimate and learn-progress before enough samples", () => {
    const line = formatHeartbeat({ ...base, subscribers: 3, samples: 7 });
    expect(line).toBe("monitor: 3 subs; raid timer 45m estimate (7/15 to learn); buffs none tracked");
  });

  it("switches to the learned median once it is available", () => {
    const line = formatHeartbeat({
      ...base,
      subscribers: 12,
      samples: 18,
      learnedMedianMs: 43 * 60_000,
    });
    expect(line).toContain("learned median 43m (18 samples)");
  });

  it("reports each faction's buff as up-with-minutes or clear", () => {
    const line = formatHeartbeat({
      ...base,
      buffs: [
        { faction: "alliance", leftMs: 74 * 60_000 },
        { faction: "horde", leftMs: null },
      ],
    });
    expect(line).toContain("alliance up 74m left, horde clear");
  });

  it("rounds partial minutes rather than truncating", () => {
    const line = formatHeartbeat({ ...base, buffs: [{ faction: "horde", leftMs: 89_000 }] });
    expect(line).toContain("horde up 1m left");
  });
});
