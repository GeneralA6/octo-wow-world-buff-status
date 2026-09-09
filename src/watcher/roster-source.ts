import type { Logger } from "../logger.js";
import type { WhoPlayer } from "../protocol/who.js";
import { DEFAULT_WHO_SLICE_DELAY_MS, fetchRoster, type WhoFn } from "./roster.js";

/**
 * One reading of who is in the lair, from whatever source produced it. The detection pipeline
 * consumes ONLY this — never `/who` directly — so a second source (the friends-list feed) can be
 * dropped in without touching the tracker. See RAID_ARCHITECTURE.md.
 *
 * `present` is the players in the watch area; `complete` says whether the source saw all of them (a
 * truncated `/who` is incomplete, and the tracker must not confirm a clear on it); `at` is when the
 * view was taken.
 *
 * (`present` currently carries the full `WhoPlayer` because the faction split still runs downstream;
 * a later migration step narrows it to name/faction/guid once that split moves into the tracker.)
 */
export interface LairView {
  readonly present: readonly WhoPlayer[];
  readonly complete: boolean;
  readonly at: number;
}

export interface RosterSource {
  /** Take one reading of the lair. Never throws for a partial result — it returns `complete: false`;
   *  it only rejects when it truly could not read at all. */
  poll(): Promise<LairView>;
}

/**
 * The `/who`-backed source: the base zone query, class-bucket-sliced past the 49 cap and spread across
 * the idle listener sockets when the lair is crowded (see roster.ts). All of that stays behind this
 * one call. It logs its own acquisition line and filters to the watch area, so the loop just gets the
 * lair occupants.
 */
export class WhoRosterSource implements RosterSource {
  readonly #who: WhoFn;
  readonly #extraWho: () => readonly WhoFn[];
  readonly #areaId: number;
  readonly #areaName: string;
  readonly #sliceDelayMs: number;
  readonly #logger: Pick<Logger, "info">;

  constructor(opts: {
    who: WhoFn;
    /** Idle listener sockets to spread class slices across; read fresh each poll (listeners come and go). */
    extraWho: () => readonly WhoFn[];
    areaId: number;
    areaName: string;
    sliceDelayMs?: number;
    logger: Pick<Logger, "info">;
  }) {
    this.#who = opts.who;
    this.#extraWho = opts.extraWho;
    this.#areaId = opts.areaId;
    this.#areaName = opts.areaName;
    this.#sliceDelayMs = opts.sliceDelayMs ?? DEFAULT_WHO_SLICE_DELAY_MS;
    this.#logger = opts.logger;
  }

  async poll(): Promise<LairView> {
    const roster = await fetchRoster(this.#who, this.#extraWho(), this.#areaId, this.#sliceDelayMs);
    const present = roster.players.filter((player) => player.areaId === this.#areaId);
    this.#logger.info(
      `who ${this.#areaName}: ${present.length} in zone ` +
        `(${roster.players.length} returned, ${roster.onlineCount} online)` +
        (roster.sliced
          ? ` [class-sliced, complete=${roster.complete}${roster.failedSlices > 0 ? `, ${roster.failedSlices} slices timed out` : ""}]`
          : ""),
    );
    return { present, complete: roster.complete, at: Date.now() };
  }
}
