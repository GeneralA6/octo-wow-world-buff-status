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

/**
 * Classes grouped into COMBINED-mask buckets so a packed lair takes 3 /who instead of 9. A /who
 * classMask is a bitmask, so one query can ask for several classes at once; three classes in even a
 * double raid (~60-80 in the lair) is comfortably under the 49 cap. Firing 9 individual slices per
 * poll tripped the server's /who throttle and blinded the tracker (52% of polls came back partial
 * at a two-raid peak); a third of the queries is a third of the throttle pressure. A bucket that DOES
 * come back capped (an extreme zerg) is sub-sliced into its individual classes — see fetchRoster.
 * The three popular classes (Warrior 1, Rogue 4, Mage 8) are split one per bucket to keep them even.
 */
export const CLASS_BUCKETS: readonly (readonly number[])[] = [
  [1, 2, 3],
  [4, 5, 7],
  [8, 9, 11],
];

/** classMask (bitmask) selecting every class in the group at once — bit for class C is 1 << (C-1). */
const maskFor = (classes: readonly number[]): number => classes.reduce((mask, c) => mask | (1 << (c - 1)), 0);

/** Default gap between /who queries — enforced GLOBALLY (the bucket queries run sequentially, not in
 *  parallel across sockets). The server's throttle appears to be per-IP, so even queries on different
 *  sockets fired at once trip it and it stops replying; one query per this interval keeps it
 *  answering. Measured live: 3 buckets fired in parallel still left 1-2 timing out at a two-raid peak. */
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

/**
 * @param pollWho   the watcher's own socket — does the base census query.
 * @param extraWho  idle listener sockets to also spread class slices across (may be empty).
 */
export async function fetchRoster(
  pollWho: WhoFn,
  extraWho: readonly WhoFn[],
  areaId: number,
  sliceDelayMs: number = DEFAULT_WHO_SLICE_DELAY_MS,
): Promise<Roster> {
  const base = await pollWho({ minLevel: 0, maxLevel: 100, zoneIds: [areaId] });
  if (base.players.length < WHO_RESULT_CAP) {
    return { players: [...base.players], onlineCount: base.onlineCount, complete: true, sliced: false, failedSlices: 0 };
  }

  // Truncated — fill in per-class-BUCKET slices to beat the cap: ask for three classes at once (one
  // query per bucket) rather than one class at a time, so a crowded lair takes 3 /who not 9.
  //
  // Run the buckets SEQUENTIALLY with a gap between every one. The server's /who throttle is (as far
  // as we can tell) per-IP — it counts all our sockets together — so firing the buckets in parallel,
  // even on different sockets, still bursts past it and 1-2 come back timed out (which kept the crowd
  // roster partial and fed spurious raid splits). One query per `sliceDelayMs`, rotated across the
  // idle listener sockets (never the poll socket, which just did the base), so no socket fires two
  // back-to-back either. A bucket that still comes back capped (an extreme zerg) is sub-sliced into
  // its own classes, still paced. A query that times out is skipped (partial, marked incomplete)
  // rather than losing the whole poll.
  const sliceSockets = extraWho.length > 0 ? [...extraWho] : [pollWho];
  let socketIndex = 0;
  const nextSocket = (): WhoFn => sliceSockets[socketIndex++ % sliceSockets.length]!;
  const query = (who: WhoFn, mask: number): Promise<WhoResult> =>
    who({ minLevel: 0, maxLevel: 100, zoneIds: [areaId], classMask: mask });

  const byName = new Map<string, WhoPlayer>();
  for (const player of base.players) byName.set(player.name, player);
  let complete = true;
  let failedSlices = 0;
  let queriesSent = 0;
  for (const bucket of CLASS_BUCKETS) {
    if (queriesSent > 0) await sleep(sliceDelayMs); // global pacing between every bucket query
    queriesSent += 1;
    try {
      const slice = await query(nextSocket(), maskFor(bucket));
      if (slice.players.length < WHO_RESULT_CAP) {
        for (const player of slice.players) byName.set(player.name, player);
        continue;
      }
      // Bucket itself hit the cap (an extreme zerg) — sub-slice it into individual classes, paced.
      for (const classId of bucket) {
        await sleep(sliceDelayMs);
        try {
          const sub = await query(nextSocket(), 1 << (classId - 1));
          for (const player of sub.players) byName.set(player.name, player);
          if (sub.players.length >= WHO_RESULT_CAP) complete = false; // >49 of one class — still truncated
        } catch {
          failedSlices += 1;
          complete = false;
        }
      }
    } catch {
      failedSlices += 1;
      complete = false; // missing this bucket's members — a partial roster, but better than none
    }
  }
  return { players: [...byName.values()], onlineCount: base.onlineCount, complete, sliced: true, failedSlices };
}
