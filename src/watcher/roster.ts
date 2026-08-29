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

export type WhoFn = (query: WhoQuery) => Promise<WhoResult>;

export interface Roster {
  readonly players: WhoPlayer[];
  readonly onlineCount: number;
  /** True if we got everyone — no query was still truncated at the cap. */
  readonly complete: boolean;
  /** Whether class-slicing was needed this poll (for logging). */
  readonly sliced: boolean;
}

export async function fetchRoster(who: WhoFn, areaId: number): Promise<Roster> {
  const base = await who({ minLevel: 0, maxLevel: 100, zoneIds: [areaId] });
  if (base.players.length < WHO_RESULT_CAP) {
    return { players: [...base.players], onlineCount: base.onlineCount, complete: true, sliced: false };
  }

  // Truncated — merge per-class slices (each class stays well under the cap).
  const byName = new Map<string, WhoPlayer>();
  for (const player of base.players) byName.set(player.name, player);
  let complete = true;
  for (const classId of CLASS_IDS) {
    const slice = await who({
      minLevel: 0,
      maxLevel: 100,
      zoneIds: [areaId],
      classMask: 1 << (classId - 1),
    });
    for (const player of slice.players) byName.set(player.name, player);
    if (slice.players.length >= WHO_RESULT_CAP) complete = false; // >49 of one class — still truncated
  }
  return { players: [...byName.values()], onlineCount: base.onlineCount, complete, sliced: true };
}
