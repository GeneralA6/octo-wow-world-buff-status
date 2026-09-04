import { describe, expect, it, vi } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { CLASS_IDS, fetchRoster, type WhoFn } from "./roster.js";

function player(name: string, classId: number): WhoPlayer {
  return { name, guild: "", level: 60, classId, raceId: 1, areaId: 2159 };
}
const classForMask = (mask: number | undefined) =>
  mask == null ? null : (CLASS_IDS.find((c) => 1 << (c - 1) === mask) ?? null);

/** A `who` that caps the base at 49 and answers each class slice from `all` (any socket can). */
function slicingWho(all: WhoPlayer[], onReject?: (classId: number | null) => boolean): ReturnType<typeof vi.fn<WhoFn>> {
  return vi.fn<WhoFn>(async (q) => {
    if (q.classMask == null) return { players: all.slice(0, 49), onlineCount: all.length };
    const classId = classForMask(q.classMask);
    if (onReject?.(classId)) throw new Error("/who timed out after 8000ms");
    return { players: all.filter((p) => p.classId === classId), onlineCount: all.length };
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

  it("slices by class and merges to see past the 49 cap (single socket)", async () => {
    const who = slicingWho(roster60());
    const r = await fetchRoster(who, [], 2159, 0);
    expect(r.sliced).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.players).toHaveLength(60);
    expect(who).toHaveBeenCalledTimes(1 + CLASS_IDS.length); // base + all 9 on the one socket
  });

  it("spreads the slices round-robin across sockets, fewer per socket, still complete", async () => {
    const all = roster60();
    const poll = slicingWho(all);
    const l1 = slicingWho(all);
    const l2 = slicingWho(all);
    const r = await fetchRoster(poll, [l1, l2], 2159, 0);
    expect(r.complete).toBe(true);
    expect(r.players).toHaveLength(60); // merged across all three
    // 9 classes over 3 sockets = 3 each; the poll socket also does the base.
    expect(poll).toHaveBeenCalledTimes(1 + 3);
    expect(l1).toHaveBeenCalledTimes(3);
    expect(l2).toHaveBeenCalledTimes(3);
  });

  it("stays incomplete when one class alone exceeds the cap", async () => {
    const warriors = Array.from({ length: 55 }, (_, i) => player(`w${i}`, 1));
    const who = vi.fn<WhoFn>(async (q) => {
      if (classForMask(q.classMask) === 1 || q.classMask == null) {
        return { players: warriors.slice(0, 49), onlineCount: 55 }; // warrior slice still capped
      }
      return { players: [], onlineCount: 55 };
    });
    const r = await fetchRoster(who, [], 2159, 0);
    expect(r.complete).toBe(false);
    expect(r.failedSlices).toBe(0);
  });

  it("keeps a PARTIAL roster when a slice times out on one socket", async () => {
    const all = roster60();
    const failClass = CLASS_IDS[1]!; // round-robins to the second socket (l1)
    const poll = slicingWho(all);
    const l1 = slicingWho(all, (c) => c === failClass);
    const l2 = slicingWho(all);
    const r = await fetchRoster(poll, [l1, l2], 2159, 0);
    expect(r.failedSlices).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.players.length).toBeGreaterThanOrEqual(49); // base + everything that answered, kept
    expect(l1).toHaveBeenCalledTimes(3); // still attempted its whole bucket
  });

  it("counts failed slices across every socket", async () => {
    const all = roster60();
    // Fail one class on each of the three sockets: classes 1 (poll), 2 (l1), 3 (l2).
    const who = () => slicingWho(all, (c) => c === 1 || c === 2 || c === 3);
    const r = await fetchRoster(who(), [who(), who()], 2159, 0);
    expect(r.failedSlices).toBe(3);
    expect(r.complete).toBe(false);
  });

  it("falls back to the poll socket alone when no listeners are up", async () => {
    const who = slicingWho(roster60());
    const r = await fetchRoster(who, [], 2159, 0);
    expect(r.complete).toBe(true);
    expect(who).toHaveBeenCalledTimes(1 + CLASS_IDS.length); // all 9 slices on the one socket
  });

  it("paces a socket's own slices behind timers instead of firing them at once", async () => {
    vi.useFakeTimers();
    try {
      const who = slicingWho(roster60());
      const promise = fetchRoster(who, [], 2159, 1_000); // one socket, 9 paced slices
      await vi.advanceTimersByTimeAsync(0); // base + first slice fire; the rest are gated on timers
      expect(who.mock.calls.length).toBeLessThan(1 + CLASS_IDS.length);
      await vi.runAllTimersAsync();
      const r = await promise;
      expect(who).toHaveBeenCalledTimes(1 + CLASS_IDS.length);
      expect(r.players).toHaveLength(60);
    } finally {
      vi.useRealTimers();
    }
  });
});
