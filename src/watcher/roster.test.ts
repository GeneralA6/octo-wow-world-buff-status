import { describe, expect, it, vi } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { CLASS_IDS, fetchRoster, type WhoFn } from "./roster.js";

function player(name: string, classId: number): WhoPlayer {
  return { name, guild: "", level: 60, classId, raceId: 1, areaId: 2159 };
}
const classForMask = (mask: number | undefined) =>
  mask == null ? null : (CLASS_IDS.find((c) => 1 << (c - 1) === mask) ?? null);

/** A `who` that caps the base at 49 and answers each class slice from `all`. */
function slicingWho(all: WhoPlayer[], onReject?: (classId: number | null) => boolean): ReturnType<typeof vi.fn<WhoFn>> {
  return vi.fn<WhoFn>(async (q) => {
    if (q.classMask == null) return { players: all.slice(0, 49), onlineCount: all.length };
    const classId = classForMask(q.classMask);
    if (onReject?.(classId)) throw new Error("/who timed out after 8000ms");
    return { players: all.filter((p) => p.classId === classId), onlineCount: all.length };
  });
}

describe("fetchRoster", () => {
  it("does a single query and does not slice when under the cap", async () => {
    const roster = Array.from({ length: 20 }, (_, i) => player(`p${i}`, 1));
    const who = vi.fn<WhoFn>().mockResolvedValue({ players: roster, onlineCount: 20 });
    const r = await fetchRoster(who, 2159, 0);
    expect(r.sliced).toBe(false);
    expect(r.complete).toBe(true);
    expect(r.failedSlices).toBe(0);
    expect(r.players).toHaveLength(20);
    expect(who).toHaveBeenCalledTimes(1);
  });

  it("slices by class and merges to see past the 49 cap", async () => {
    const all = Array.from({ length: 60 }, (_, i) => player(`p${i}`, CLASS_IDS[i % CLASS_IDS.length]!));
    const who = slicingWho(all);
    const r = await fetchRoster(who, 2159, 0);
    expect(r.sliced).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.failedSlices).toBe(0);
    expect(r.players).toHaveLength(60); // complete roster despite the cap
    expect(who).toHaveBeenCalledTimes(1 + CLASS_IDS.length);
  });

  it("stays incomplete when one class alone exceeds the cap", async () => {
    const warriors = Array.from({ length: 55 }, (_, i) => player(`w${i}`, 1));
    const who = vi.fn<WhoFn>(async (q) => {
      if (classForMask(q.classMask) === 1 || q.classMask == null) {
        return { players: warriors.slice(0, 49), onlineCount: 55 }; // warrior slice still capped
      }
      return { players: [], onlineCount: 55 };
    });
    const r = await fetchRoster(who, 2159, 0);
    expect(r.complete).toBe(false);
    expect(r.sliced).toBe(true);
    expect(r.failedSlices).toBe(0);
  });

  it("keeps a PARTIAL roster when a slice times out, rather than losing the whole poll", async () => {
    const all = Array.from({ length: 60 }, (_, i) => player(`p${i}`, CLASS_IDS[i % CLASS_IDS.length]!));
    const failClass = CLASS_IDS[2]!;
    const who = slicingWho(all, (classId) => classId === failClass);
    const r = await fetchRoster(who, 2159, 0);
    expect(r.failedSlices).toBe(1);
    expect(r.complete).toBe(false); // a missing class means it's not the full picture
    expect(r.sliced).toBe(true);
    expect(r.players.length).toBeGreaterThanOrEqual(49); // base + every slice that DID answer, kept
    expect(who).toHaveBeenCalledTimes(1 + CLASS_IDS.length); // still attempted every slice
  });

  it("counts every failed slice and still returns", async () => {
    const all = Array.from({ length: 60 }, (_, i) => player(`p${i}`, CLASS_IDS[i % CLASS_IDS.length]!));
    const who = slicingWho(all, (classId) => classId === 1 || classId === 2 || classId === 3);
    const r = await fetchRoster(who, 2159, 0);
    expect(r.failedSlices).toBe(3);
    expect(r.complete).toBe(false);
  });

  it("paces the slices behind timers instead of firing them all at once", async () => {
    vi.useFakeTimers();
    try {
      const all = Array.from({ length: 60 }, (_, i) => player(`p${i}`, CLASS_IDS[i % CLASS_IDS.length]!));
      const who = slicingWho(all);
      const promise = fetchRoster(who, 2159, 1_000);
      await vi.advanceTimersByTimeAsync(0); // base query runs; the first slice is gated behind a 1s timer
      expect(who.mock.calls.length).toBeLessThan(1 + CLASS_IDS.length); // not all fired synchronously
      await vi.runAllTimersAsync();
      const r = await promise;
      expect(who).toHaveBeenCalledTimes(1 + CLASS_IDS.length);
      expect(r.players).toHaveLength(60);
    } finally {
      vi.useRealTimers();
    }
  });
});
