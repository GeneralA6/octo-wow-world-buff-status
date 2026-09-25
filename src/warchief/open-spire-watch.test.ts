import { describe, expect, it, vi } from "vitest";
import type { ShadowNotice } from "./format.js";
import { openSpireWatch, orMemory } from "./open-spire-watch.js";

const MIN = 60_000;
const T0 = 1_790_000_000_000;

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("openSpireWatch", () => {
  it("keeps everything in memory without MongoDB, and says so", async () => {
    const log = logger();
    await openSpireWatch({ database: null, blessings: async () => [], notify: vi.fn(async () => {}), logger: log });
    expect(log.info).toHaveBeenCalledWith("spire: picked up from 0 kept readings");
    expect(log.info).toHaveBeenCalledWith("spire readings: no MongoDB — keeping it in memory, lost on restart");
    expect(log.info).toHaveBeenCalledWith("spire runs: no MongoDB — keeping it in memory, lost on restart");
  });

  it("wires a working watch: readings in, a blessing judged against them", async () => {
    const notices: ShadowNotice[] = [];
    const opened = await openSpireWatch({
      database: null,
      blessings: async () => [],
      notify: async (notice) => {
        notices.push(notice);
      },
      logger: logger(),
    });
    await opened.watch.observe({ present: [], complete: true, at: T0 });
    await opened.watch.onBlessing(new Date(T0 + 5 * MIN));
    // Five minutes of readings is too little to fault it for missing a run.
    expect(notices[0]?.body).toContain("The watch saw only");
    await expect(opened.close()).resolves.toBeUndefined();
  });
});

describe("orMemory", () => {
  it("uses the database store when it opens", async () => {
    const log = logger();
    expect(await orMemory("things", log, async () => "mongo", () => "memory")).toBe("mongo");
    expect(log.info).toHaveBeenCalledWith("things: recording to MongoDB");
  });

  it("falls back to memory, logged, when the database store will not open", async () => {
    const log = logger();
    const got = await orMemory(
      "things",
      log,
      async () => {
        throw new Error("auth failed");
      },
      () => "memory",
    );
    expect(got).toBe("memory");
    expect(log.error).toHaveBeenCalledWith("things: MongoDB connect failed (auth failed); keeping it in memory");
  });
});
