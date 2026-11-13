import { describe, expect, it, vi } from "vitest";
import { DepartureShadow } from "./departure-shadow.js";

const MIN = 60_000;
const raid = (size: number): string[] => Array.from({ length: size }, (_, i) => `p${i}`);
const settings = { minStayMs: 10 * MIN, minGroup: 15, sustainedMs: 5 * MIN };

async function run(shadow: DepartureShadow, toMin: number, roster: (m: number) => readonly string[], warnAfterMs: () => Promise<number>) {
  for (let m = 0; m <= toMin; m += 1) await shadow.observe({ names: roster(m), complete: true, at: m * MIN }, warnAfterMs);
}

describe("DepartureShadow", () => {
  it("logs the clear it would announce, and nothing else, for a raid that left", async () => {
    const logger = { info: vi.fn() };
    const shadow = new DepartureShadow("onyxia", settings, logger);
    const players = raid(20);
    await run(shadow, 40, (m) => (m < 30 ? players : []), async () => 60 * MIN);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("onyxia departure shadow: would announce a clear — 20 left within 0m after ~29m in the lair");
  });

  it("logs the heads-up once when the players in have stayed past the warning time", async () => {
    const logger = { info: vi.fn() };
    const shadow = new DepartureShadow("bwl", settings, logger);
    await run(shadow, 30, () => raid(20), async () => 25 * MIN);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('bwl departure shadow: would announce "might end soon" — 20 in the lair for ~25m');
  });

  it("does not ask for the warning time while the lair holds too few to warn about", async () => {
    const warnAfterMs = vi.fn(async () => 0);
    const shadow = new DepartureShadow("onyxia", settings, { info: vi.fn() });
    await run(shadow, 5, () => raid(10), warnAfterMs);
    expect(warnAfterMs).not.toHaveBeenCalled();
  });
});
