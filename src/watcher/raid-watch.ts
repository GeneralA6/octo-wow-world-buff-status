import type { WhoPlayer } from "../protocol/who.js";
import { ClearTracker, type ConfirmedClear } from "./clear-tracker.js";
import { PresenceTracker, type PresenceChange } from "./presence.js";
import { RaidSessions } from "./raid-sessions.js";
import { RaidTracker, type ActiveRaid, type GroupingMode, type RaidEvent } from "./raid-tracker.js";

/**
 * Raid detection over one roster — a whole lair (crossfaction realm) or one faction's
 * slice of it (faction realm). Bundles the presence census and both detectors so the
 * state persists across reconnects and stays testable.
 *
 * Blackout (a long blind gap) is absorbed internally: every detector re-baselines and
 * no events fire, so a crash-and-refill isn't read as a raid starting or ending.
 */
export interface RaidWatchOptions {
  readonly minRaidSize: number;
  readonly grouping: GroupingMode;
  readonly clearSize: number;
  /** How long the roster must stay gone for a departure to count as a real clear (not a wipe). */
  readonly clearSustainedMs: number;
}

export interface RaidObservation {
  readonly change: PresenceChange;
  readonly countEvents: readonly RaidEvent[];
  readonly temporalEvents: readonly RaidEvent[];
  /** A real, completed clear was confirmed this poll — the ground truth for the timer. */
  readonly clear: ConfirmedClear | null;
}

export class RaidWatch {
  readonly #presence = new PresenceTracker();
  readonly #tracker: RaidTracker;
  readonly #sessions: RaidSessions;
  readonly #clears: ClearTracker;

  constructor(options: RaidWatchOptions) {
    this.#tracker = new RaidTracker(options.minRaidSize, options.grouping, options.clearSize);
    this.#sessions = new RaidSessions({ formAt: options.minRaidSize });
    this.#clears = new ClearTracker({ formAt: options.minRaidSize, sustainedMs: options.clearSustainedMs });
  }

  observe(players: readonly WhoPlayer[], now: number, complete: boolean): RaidObservation {
    const names = players.map((player) => player.name);
    const change = this.#presence.observe(names, now, complete);
    if (change.blackout) {
      this.#tracker.rebaseline(players);
      this.#sessions.update(change); // clears its state on blackout too
      this.#clears.observe(names, now, true); // discard any in-progress clear measurement
      return { change, countEvents: [], temporalEvents: [], clear: null };
    }
    return {
      change,
      countEvents: this.#tracker.update(players),
      temporalEvents: this.#sessions.update(change),
      clear: this.#clears.observe(names, now, false),
    };
  }

  /** Raids this watch has in progress — for the status query. */
  activeRaids(): ActiveRaid[] {
    return this.#tracker.activeRaids();
  }

  /** How long the raid in progress has been in the lair (form → now, spanning wipes), or
   *  null if none is being tracked — for the status query. */
  raidElapsedMs(now: number): number | null {
    return this.#clears.elapsedMs(now);
  }
}
