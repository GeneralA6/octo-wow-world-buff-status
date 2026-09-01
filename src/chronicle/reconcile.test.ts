import { describe, expect, it } from "vitest";
import type { PollSnapshot } from "../watcher/snapshot-store.js";
import { countDistinctRaids, isConfirmed, reconcile } from "./reconcile.js";
import type { OnyxiaKill } from "./types.js";

const T0 = new Date("2026-09-01T02:00:00Z").getTime();
const at = (minutes: number): Date => new Date(T0 + minutes * 60_000);

function kill(over: Partial<OnyxiaKill> = {}): OnyxiaKill {
  return { logId: "l", realm: "N'Zoth", uploader: "Anaeri", guild: "Phoenix", at: at(0), playerCount: 28, ...over };
}
function snap(minutes: number, names: string[]): PollSnapshot {
  return { ts: at(minutes), present: names.length, complete: true, names };
}

const WINDOW = 15 * 60_000;

describe("isConfirmed", () => {
  it("is true when the uploader is in a roster within the window", () => {
    expect(isConfirmed(kill({ at: at(0) }), [snap(-5, ["Zug", "Anaeri", "Bob"])], WINDOW)).toBe(true);
  });
  it("matches case-insensitively (WoW names)", () => {
    expect(isConfirmed(kill({ uploader: "ANAERI" }), [snap(3, ["anaeri"])], WINDOW)).toBe(true);
  });
  it("is false when the only matching roster is outside the window", () => {
    expect(isConfirmed(kill({ at: at(0) }), [snap(30, ["Anaeri"])], WINDOW)).toBe(false);
  });
  it("is false when the uploader is in no roster at all (a missed raid)", () => {
    expect(isConfirmed(kill({ uploader: "Ghost" }), [snap(0, ["Anaeri", "Bob"])], WINDOW)).toBe(false);
  });
});

describe("countDistinctRaids", () => {
  it("is 0 for none and 1 for a single kill", () => {
    expect(countDistinctRaids([], 10 * 60_000)).toBe(0);
    expect(countDistinctRaids([kill()], 10 * 60_000)).toBe(1);
  });
  it("collapses uploads of one raid (near-identical start) into one", () => {
    const uploads = [kill({ at: at(0) }), kill({ at: at(1) }), kill({ at: at(2) })];
    expect(countDistinctRaids(uploads, 10 * 60_000)).toBe(1);
  });
  it("separates raids whose starts are beyond the cluster window", () => {
    const kills = [kill({ at: at(0) }), kill({ at: at(30) }), kill({ at: at(31) })];
    expect(countDistinctRaids(kills, 10 * 60_000)).toBe(2); // {0} and {30,31}
  });
});

describe("reconcile", () => {
  it("partitions confirmed vs missed and tallies distinct raids", () => {
    // Two uploads of one detected raid (Anaeri seen ~02:00), and one missed raid (Ghost, ~03:00).
    const kills = [
      kill({ logId: "a", uploader: "Anaeri", at: at(0) }),
      kill({ logId: "b", uploader: "Bob", at: at(1) }),
      kill({ logId: "c", uploader: "Ghost", at: at(60) }),
    ];
    const snapshots = [snap(-2, ["Anaeri", "Bob", "Zug"]), snap(0, ["Anaeri", "Bob", "Zug"])];
    const rec = reconcile(kills, snapshots, WINDOW);
    expect(rec.confirmed.map((k) => k.logId)).toEqual(["a", "b"]);
    expect(rec.missed.map((k) => k.logId)).toEqual(["c"]);
    expect(rec.distinctRaids).toBe(2); // {02:00,02:01} + {03:00}
    expect(rec.distinctMissed).toBe(1); // just Ghost's
  });

  it("marks everything missed when we have no roster history", () => {
    const rec = reconcile([kill(), kill({ logId: "b" })], [], WINDOW);
    expect(rec.confirmed).toHaveLength(0);
    expect(rec.missed).toHaveLength(2);
  });
});
