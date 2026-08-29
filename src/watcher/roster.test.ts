import { describe, expect, it, vi } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { CLASS_IDS, fetchRoster, type WhoFn } from "./roster.js";

function player(name: string, classId: number): WhoPlayer {
  return { name, guild: "", level: 60, classId, raceId: 1, areaId: 2159 };
}
const classForMask = (mask: number | undefined) =>
  mask == null ? null : (CLASS_IDS.find((c) => 1 << (c - 1) === mask) ?? null);

describe("fetchRoster", () => {
  it("does a single query and does not slice when under the cap", async () => {
    const roster = Array.from({ length: 20 }, (_, i) => player(`p${i}`, 1));
    const who = vi.fn<WhoFn>().mockResolvedValue({ players: roster, onlineCount: 20 });
    const r = await fetchRoster(who, 2159);
    expect(r.sliced).toBe(false);
    expect(r.complete).toBe(true);
    expect(r.players).toHaveLength(20);
    expect(who).toHaveBeenCalledTimes(1);
  });

  it("slices by class and merges to see past the 49 cap", async () => {
    // 60 players spread across every class.
    const all = Array.from({ length: 60 }, (_, i) => player(`p${i}`, CLASS_IDS[i % CLASS_IDS.length]!));
    const who = vi.fn<WhoFn>(async (q) => {
      if (q.classMask == null) return { players: all.slice(0, 49), onlineCount: 60 }; // base is capped
      const classId = classForMask(q.classMask);
      return { players: all.filter((p) => p.classId === classId), onlineCount: 60 };
    });
    const r = await fetchRoster(who, 2159);
    expect(r.sliced).toBe(true);
    expect(r.complete).toBe(true);
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
    const r = await fetchRoster(who, 2159);
    expect(r.complete).toBe(false);
    expect(r.sliced).toBe(true);
  });
});
