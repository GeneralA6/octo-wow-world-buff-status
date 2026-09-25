import { describe, expect, it, vi } from "vitest";
import type { ShadowNotice } from "./format.js";
import { InMemorySpireRunStore, type SpireRunStore } from "./run-store.js";
import { InMemorySpireSnapshotStore } from "./spire-snapshot-store.js";
import { SpireRunTracker } from "./spire-runs.js";
import type { SpirePlayer, SpireView } from "./spire-view.js";
import { SpireWatch } from "./spire-watch.js";

const MIN = 60_000;
const T0 = 1_790_000_000_000;
const ORC = 2;
const HUMAN = 1;

const player = (name: string, raceId: number): SpirePlayer => ({ name, guild: "", level: 60, classId: 1, raceId });

/** Ten players walking in one a minute from `from`, leaving together at `to` (minutes after T0). */
const raid = (prefix: string, from: number, to: number, raceId = ORC) =>
  Array.from({ length: 10 }, (_, i) => ({ player: player(`${prefix}${i}`, raceId), from: from + i, to }));

type Stay = ReturnType<typeof raid>[number];

function view(stays: readonly Stay[], minute: number): SpireView {
  const present = stays.filter((s) => s.from <= minute && minute < s.to).map((s) => s.player);
  return { present, complete: true, at: T0 + minute * MIN };
}

function setup(options: { runs?: SpireRunStore; blessings?: Date[] } = {}) {
  const snapshots = new InMemorySpireSnapshotStore();
  const runs = options.runs ?? new InMemorySpireRunStore();
  const blessings = options.blessings ?? [];
  const notices: ShadowNotice[] = [];
  const notify = vi.fn(async (notice: ShadowNotice) => {
    notices.push(notice);
  });
  const logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };
  const watch = new SpireWatch({
    tracker: new SpireRunTracker(),
    snapshots,
    runs,
    blessings: async () => blessings,
    notify,
    logger,
  });
  /** Feed one reading a minute over [start, end]. */
  const play = async (stays: readonly Stay[], start: number, end: number): Promise<void> => {
    for (let minute = start; minute <= end; minute += 1) await watch.observe(view(stays, minute));
  };
  return { watch, snapshots, runs, blessings, notices, notify, logger, play };
}

const titles = (notices: readonly ShadowNotice[]) => notices.map((n) => n.title);

describe("SpireWatch", () => {
  it("keeps every reading", async () => {
    const { play, snapshots } = setup();
    await play(raid("r", 2, 60), 0, 4);
    await Promise.resolve();
    const kept = await snapshots.between(new Date(0), new Date(T0 + 60 * MIN));
    expect(kept.map((s) => s.players.length)).toEqual([0, 0, 1, 2, 3]);
  });

  it("posts a Horde run coming in and leaving, and keeps the finished run", async () => {
    const { play, notices, runs } = setup();
    await play(raid("r", 2, 45), 0, 55);
    expect(titles(notices)).toEqual([
      "🔥 UBRS run in Blackrock Spire (shadow)",
      "🏁 UBRS run left Blackrock Spire (shadow)",
    ]);
    expect(notices[1]?.body).toContain("a first guess of 45m");
    const [kept] = await runs.endedSince(new Date(0));
    expect(kept).toMatchObject({ reason: "left", peak: 10, horde: 10, endedAt: new Date(T0 + 45 * MIN) });
  });

  it("logs a run no Horde could turn in for, but posts nothing about it", async () => {
    const { play, notices, logger, runs } = setup();
    await play(raid("a", 2, 45, HUMAN), 0, 55);
    expect(notices).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/^spire: run #1 in — 8 players \(0 Horde\)/));
    expect(await runs.endedSince(new Date(0))).toHaveLength(1);
  });

  it("credits a blessing to the run that just left, with the score", async () => {
    const { play, watch, notices, blessings } = setup();
    await play(raid("r", 2, 45), 0, 55);
    const at = new Date(T0 + 57 * MIN);
    blessings.push(at); // the Warchief tracker's own write may land first; it must not count twice
    await watch.onBlessing(at);
    const verdict = notices[notices.length - 1]!;
    expect(verdict.title).toBe("⚔️ Warchief's Blessing vs the forecast (shadow)");
    expect(verdict.body).toContain("Came 12m after the run from");
    expect(verdict.body).toContain("Score: 1/1 blessings explained by a Spire run (0 mid-run), 1/1 Horde runs led to one");
  });

  it("recognises a blessing that dropped while the run was still inside", async () => {
    const { play, watch, notices } = setup();
    await play(raid("r", 2, 90), 0, 30);
    await watch.onBlessing(new Date(T0 + 30 * MIN));
    expect(notices[notices.length - 1]?.body).toContain("Dropped 28m into the run still inside");
  });

  it("owns up to a blessing no run explains, when it was watching", async () => {
    const { play, watch, notices } = setup();
    await play([], 0, 160);
    await watch.onBlessing(new Date(T0 + 160 * MIN));
    expect(notices[0]?.body).toContain("No Spire run explains it");
    expect(notices[0]?.body).toContain("Score: 0/1 blessings explained");
  });

  it("gives no verdict on a blessing it was too blind to see coming, and does not score it", async () => {
    const { play, watch, notices, logger } = setup();
    await play([], 0, 5);
    await watch.onBlessing(new Date(T0 + 5 * MIN));
    expect(notices[0]?.body).toContain("The watch saw only 3% of the Spire");
    expect(notices[0]?.body).toContain("Score: 0/0 blessings explained by a Spire run (0 mid-run), 1 more unscored");
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("the watch was blind — it saw 3% of the Spire before it"));
  });

  it("is blind to a blessing after its readings stopped coming, however long it watched before", async () => {
    const { play, watch, notices } = setup();
    await play([], 0, 160);
    // Every read after minute 160 went unanswered; the blessing comes at 300.
    await watch.onBlessing(new Date(T0 + 300 * MIN));
    expect(notices[0]?.body).toContain("The watch saw only");
  });

  it("does not score blessings from before the watch was looking", async () => {
    const { play, watch, notices, blessings } = setup();
    blessings.push(new Date(T0 - 60 * MIN));
    await play([], 0, 160);
    await watch.onBlessing(new Date(T0 + 160 * MIN));
    expect(notices[0]?.body).toContain("Score: 0/1 blessings explained");
  });

  it("still follows the runs when the run store fails", async () => {
    const failing: SpireRunStore = {
      record: vi.fn(async () => {
        throw new Error("mongo down");
      }),
      endedSince: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    };
    const { play, notices, logger } = setup({ runs: failing });
    await play(raid("r", 2, 45), 0, 55);
    expect(logger.error).toHaveBeenCalledWith("spire run store: mongo down");
    expect(titles(notices)).toHaveLength(2);
  });

  it("logs the score on the first reading, then at most hourly", async () => {
    const { play, logger } = setup();
    await play([], 0, 61);
    const scoreLines = logger.info.mock.calls.filter(([line]) => String(line).startsWith("warchief forecast: Score"));
    expect(scoreLines).toHaveLength(2); // minute 0 and minute 60
  });

  it("keeps going when the channel refuses a notice", async () => {
    const { play, notify, logger } = setup();
    notify.mockRejectedValue(new Error("discord 500"));
    await play(raid("r", 2, 45), 0, 55);
    expect(logger.error).toHaveBeenCalledWith("warchief forecast notify: discord 500");
  });
});
