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

/** Default gap between /who queries on one socket. The server throttles /who: slices fired
 *  back-to-back trip it and it stops replying (every subsequent /who then times out), which is what
 *  blinded the raid tracker at a two-raid peak. Spacing them keeps it answering. */
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

  // Truncated — fill in per-class-BUCKET slices to beat the cap. The server throttles /who, so we
  // ask for three classes at once (one query per bucket) rather than one class at a time: 3 /who a
  // poll instead of 9. Spread the buckets round-robin across every socket we have — the poll socket
  // plus any idle listener sockets — run the sockets in PARALLEL, and pace each socket's own queries.
  // A bucket that still comes back capped is sub-sliced into its own classes on that socket. A query
  // that times out is skipped (partial, marked incomplete) rather than losing the whole poll.
  const runners = [pollWho, ...extraWho];
  const assigned: (readonly number[])[][] = runners.map(() => []);
  CLASS_BUCKETS.forEach((bucket, i) => assigned[i % runners.length]!.push(bucket));

  const perRunner = await Promise.all(
    runners.map(async (who, ri) => {
      const found: WhoPlayer[] = [];
      let complete = true;
      let failed = 0;
      const query = (mask: number): Promise<WhoResult> =>
        who({ minLevel: 0, maxLevel: 100, zoneIds: [areaId], classMask: mask });
      const buckets = assigned[ri]!;
      let queriesSent = 0;
      for (const bucket of buckets) {
        if (queriesSent > 0) await sleep(sliceDelayMs); // pace this socket's own queries
        queriesSent += 1;
        try {
          const slice = await query(maskFor(bucket));
          if (slice.players.length < WHO_RESULT_CAP) {
            for (const player of slice.players) found.push(player);
            continue;
          }
          // Bucket itself hit the cap (an extreme zerg) — sub-slice it into individual classes.
          for (const classId of bucket) {
            await sleep(sliceDelayMs);
            try {
              const sub = await query(1 << (classId - 1));
              for (const player of sub.players) found.push(player);
              if (sub.players.length >= WHO_RESULT_CAP) complete = false; // >49 of one class — still truncated
            } catch {
              failed += 1;
              complete = false;
            }
          }
        } catch {
          failed += 1;
          complete = false; // missing this bucket's members — a partial roster, but better than none
        }
      }
      return { found, complete, failed };
    }),
  );

  const byName = new Map<string, WhoPlayer>();
  for (const player of base.players) byName.set(player.name, player);
  let complete = true;
  let failedSlices = 0;
  for (const r of perRunner) {
    for (const player of r.found) byName.set(player.name, player);
    if (!r.complete) complete = false;
    failedSlices += r.failed;
  }
  return { players: [...byName.values()], onlineCount: base.onlineCount, complete, sliced: true, failedSlices };
}
