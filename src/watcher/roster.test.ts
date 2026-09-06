import { describe, expect, it, vi } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { CLASS_BUCKETS, CLASS_IDS, fetchRoster, type WhoFn } from "./roster.js";

function player(name: string, classId: number): WhoPlayer {
  return { name, guild: "", level: 60, classId, raceId: 1, areaId: 2159 };
}
/** Which classes a (possibly combined) classMask selects. */
const classesInMask = (mask: number | undefined): number[] =>
  mask == null ? [] : CLASS_IDS.filter((c) => (mask & (1 << (c - 1))) !== 0);

/**
 * A `who` that caps every response at 49 (like the server) and answers a class-filtered query from
 * `all`. A combined-bucket mask returns players of ANY class in it. `onReject` fails a query for the
 * given classes (a timeout).
 */
function slicingWho(all: WhoPlayer[], onReject?: (classes: number[]) => boolean): ReturnType<typeof vi.fn<WhoFn>> {
  return vi.fn<WhoFn>(async (q) => {
    if (q.classMask == null) return { players: all.slice(0, 49), onlineCount: all.length };
    const classes = classesInMask(q.classMask);
    if (onReject?.(classes)) throw new Error("/who timed out after 8000ms");
    const matched = all.filter((p) => classes.includes(p.classId));
    return { players: matched.slice(0, 49), onlineCount: all.length };
  });
}
const roster60 = () => Array.from({ length: 60 }, (_, i) => player(`p${i}`, CLASS_IDS[i % CLASS_IDS.length]!));

describe("fetchRoster", () => {
  it("does a single query and does not slice when under the cap", async () => {
    const players = Array.from({ length: 20 }, (_, i) => player(`p${i}`, 1));
    const who = vi.fn<WhoFn>().mockResolvedValue({ players, onlineCount: 20 });
    const r = await fetchRoster(who, [], 2159, 0);
    expect(r.sliced).toBe(false);
    expect(r.complete).toBe(true);
    expect(r.failedSlices).toBe(0);
    expect(r.players).toHaveLength(20);
    expect(who).toHaveBeenCalledTimes(1);
  });

  it("slices by class-BUCKET (3 queries, not 9) and merges past the 49 cap", async () => {
    const who = slicingWho(roster60());
    const r = await fetchRoster(who, [], 2159, 0);
    expect(r.sliced).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.players).toHaveLength(60);
    // base + one query per bucket (3), NOT one per class (9) — the whole point of the change.
    expect(who).toHaveBeenCalledTimes(1 + CLASS_BUCKETS.length);
    expect(CLASS_BUCKETS.length).toBe(3);
  });

  it("spreads the buckets round-robin across sockets, one each, still complete", async () => {
    const all = roster60();
    const poll = slicingWho(all);
    const l1 = slicingWho(all);
    const l2 = slicingWho(all);
    const r = await fetchRoster(poll, [l1, l2], 2159, 0);
    expect(r.complete).toBe(true);
    expect(r.players).toHaveLength(60);
    // 3 buckets over 3 sockets = 1 each; the poll socket also does the base.
    expect(poll).toHaveBeenCalledTimes(1 + 1);
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });

  it("sub-slices a bucket that itself comes back capped (an extreme zerg) into its classes", async () => {
    // 55 of one class (in bucket [1,2,3]) makes the combined bucket query hit the cap.
    const warriors = Array.from({ length: 55 }, (_, i) => player(`w${i}`, 1));
    const who = slicingWho(warriors);
    const r = await fetchRoster(who, [], 2159, 0);
    expect(r.complete).toBe(false); // one class alone exceeds 49 — genuinely can't be completed
    expect(r.failedSlices).toBe(0);
    // base + bucket[1,2,3] (capped) + its 3 class sub-slices + the other 2 buckets = 1+1+3+2 = 7.
    expect(who).toHaveBeenCalledTimes(1 + 1 + 3 + 2);
  });

  it("keeps a PARTIAL roster when a bucket query times out on one socket", async () => {
    const all = roster60();
    const poll = slicingWho(all); // bucket [1,2,3]
    const l1 = slicingWho(all, (classes) => classes.includes(4)); // bucket [4,5,7] fails on l1
    const l2 = slicingWho(all); // bucket [8,9,11]
    const r = await fetchRoster(poll, [l1, l2], 2159, 0);
    expect(r.failedSlices).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.players.length).toBeGreaterThanOrEqual(49); // base + the buckets that answered, kept
  });

  it("counts failed buckets across every socket", async () => {
    const all = roster60();
    const who = () => slicingWho(all, () => true); // every bucket query times out
    const r = await fetchRoster(who(), [who(), who()], 2159, 0);
    expect(r.failedSlices).toBe(3); // one bucket per socket, all failed
    expect(r.complete).toBe(false);
  });

  it("falls back to the poll socket alone when no listeners are up", async () => {
    const who = slicingWho(roster60());
    const r = await fetchRoster(who, [], 2159, 0);
    expect(r.complete).toBe(true);
    expect(who).toHaveBeenCalledTimes(1 + CLASS_BUCKETS.length); // all 3 buckets on the one socket
  });

  it("paces a socket's own queries behind timers instead of firing them at once", async () => {
    vi.useFakeTimers();
    try {
      const who = slicingWho(roster60());
      const promise = fetchRoster(who, [], 2159, 1_000); // one socket, 3 paced buckets
      await vi.advanceTimersByTimeAsync(0); // base + first bucket fire; the rest are gated on timers
      expect(who.mock.calls.length).toBeLessThan(1 + CLASS_BUCKETS.length);
      await vi.runAllTimersAsync();
      const r = await promise;
      expect(who).toHaveBeenCalledTimes(1 + CLASS_BUCKETS.length);
      expect(r.players).toHaveLength(60);
    } finally {
      vi.useRealTimers();
    }
  });
});
