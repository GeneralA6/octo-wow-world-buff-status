import { type WhoPlayer, type WhoQuery, type WhoResult } from "../protocol/who.js";
import { WHO_RESULT_CAP } from "./presence.js";

/**
 * Beats the 49-result /who cap. A single /who returns at most 49 players, so a
 * packed lair (multiple raids, 50-80 players) is truncated. When that happens we
 * re-query per class and merge — each class in a raid zone is comfortably under the
 * cap — to get a COMPLETE roster. Adaptive: the common case (< 49) is one query;
 * slicing only kicks in when we're actually at the cap.
 *
 * Vanilla class ids (6 and 10 are unused). classMask bit for class C is 1 << (C-1).
 */
export const CLASS_IDS = [1, 2, 3, 4, 5, 7, 8, 9, 11] as const;

/** Default gap between class-slice /who queries. The server throttles /who: a packed lair's ~9
 *  slices fired back-to-back trip it and it stops replying (every subsequent /who then times out),
 *  which is what blinded the raid tracker at a two-raid peak. Spacing them keeps it answering. */
export const DEFAULT_WHO_SLICE_DELAY_MS = 1_500;

export type WhoFn = (query: WhoQuery) => Promise<WhoResult>;

export interface Roster {
  readonly players: WhoPlayer[];
  readonly onlineCount: number;
  /** True if we got everyone — no query was truncated at the cap AND no slice failed. */
  readonly complete: boolean;
  /** Whether class-slicing was needed this poll (for logging). */
  readonly sliced: boolean;
  /** How many class slices failed (timed out). >0 means a PARTIAL roster (complete is false) —
   *  kept rather than discarded, so one dropped slice can't blind the whole poll. */
  readonly failedSlices: number;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export async function fetchRoster(
  who: WhoFn,
  areaId: number,
  sliceDelayMs: number = DEFAULT_WHO_SLICE_DELAY_MS,
): Promise<Roster> {
  const base = await who({ minLevel: 0, maxLevel: 100, zoneIds: [areaId] });
  if (base.players.length < WHO_RESULT_CAP) {
    return { players: [...base.players], onlineCount: base.onlineCount, complete: true, sliced: false, failedSlices: 0 };
  }

  // Truncated — merge per-class slices (each class stays well under the cap). Two guards against the
  // /who throttle that killed a packed poll: pace the slices so the server keeps answering, and if a
  // slice still times out, keep the rest (partial, marked incomplete) rather than losing everything.
  const byName = new Map<string, WhoPlayer>();
  for (const player of base.players) byName.set(player.name, player);
  let complete = true;
  let failedSlices = 0;
  for (const classId of CLASS_IDS) {
    await sleep(sliceDelayMs);
    try {
      const slice = await who({ minLevel: 0, maxLevel: 100, zoneIds: [areaId], classMask: 1 << (classId - 1) });
      for (const player of slice.players) byName.set(player.name, player);
      if (slice.players.length >= WHO_RESULT_CAP) complete = false; // >49 of one class — still truncated
    } catch {
      failedSlices += 1;
      complete = false; // missing this class's members — a partial roster, but better than none
    }
  }
  return { players: [...byName.values()], onlineCount: base.onlineCount, complete, sliced: true, failedSlices };
}
