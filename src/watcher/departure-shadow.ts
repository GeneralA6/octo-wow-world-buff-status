import type { Logger } from "../logger.js";
import { DepartureDetector, type DepartureSettings } from "./departure-detector.js";

/** Whole minutes, for the log wording. */
function mins(ms: number): number {
  return Math.round(ms / 60_000);
}

/** One poll of the whole lair, as the shadow reads it. */
export interface ShadowPoll {
  readonly names: readonly string[];
  readonly complete: boolean;
  readonly at: number;
}

/**
 * Runs the departure-burst detector beside the live ClearTracker and only LOGS what it would have
 * announced — "cleared" per departing block, and "might end soon" per block of players in long
 * enough — so a live evening can be compared line by line with the tracker's own alerts before it
 * drives anything. No alert, store or ledger is touched. State is in memory: a restart starts over,
 * so a raid already in progress then is read from the restart on (its stay looks shorter).
 */
export class DepartureShadow {
  readonly #detector: DepartureDetector;
  readonly #minGroup: number;
  readonly #label: string;
  readonly #logger: Pick<Logger, "info">;

  constructor(label: string, settings: DepartureSettings, logger: Pick<Logger, "info">) {
    this.#detector = new DepartureDetector(settings);
    this.#minGroup = settings.minGroup;
    this.#label = label;
    this.#logger = logger;
  }

  /**
   * Feeds one poll. `warnAfterMs` is how long a player must have been in before the heads-up — the
   * predicted clear time less the lead — asked for only when the lair holds enough players to warn.
   */
  async observe(poll: ShadowPoll, warnAfterMs: () => Promise<number>): Promise<void> {
    for (const group of this.#detector.observe(poll)) {
      const spreadMin = mins(group.lastLeftAt - group.firstLeftAt);
      this.#logger.info(
        `${this.#label} departure shadow: would announce a clear — ${group.size} left within ${spreadMin}m ` +
          `after ~${mins(group.medianStayMs)}m in the lair`,
      );
    }
    if (poll.names.length < this.#minGroup) return;
    const due = this.#detector.dueForWarning(poll.at, await warnAfterMs());
    if (due !== null) {
      this.#logger.info(
        `${this.#label} departure shadow: would announce "might end soon" — ${due.size} in the lair for ~${mins(due.medianStayMs)}m`,
      );
    }
  }
}
