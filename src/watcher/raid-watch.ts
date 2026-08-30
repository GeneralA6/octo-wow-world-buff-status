import type { WhoPlayer } from "../protocol/who.js";
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
}

export interface RaidObservation {
  readonly change: PresenceChange;
  readonly countEvents: readonly RaidEvent[];
  readonly temporalEvents: readonly RaidEvent[];
}

export class RaidWatch {
  readonly #presence = new PresenceTracker();
  readonly #tracker: RaidTracker;
  readonly #sessions: RaidSessions;

  constructor(options: RaidWatchOptions) {
    this.#tracker = new RaidTracker(options.minRaidSize, options.grouping, options.clearSize);
    this.#sessions = new RaidSessions({ formAt: options.minRaidSize });
  }

  observe(players: readonly WhoPlayer[], now: number, complete: boolean): RaidObservation {
    const change = this.#presence.observe(
      players.map((player) => player.name),
      now,
      complete,
    );
    if (change.blackout) {
      this.#tracker.rebaseline(players);
      this.#sessions.update(change); // clears its state on blackout too
      return { change, countEvents: [], temporalEvents: [] };
    }
    return {
      change,
      countEvents: this.#tracker.update(players),
      temporalEvents: this.#sessions.update(change),
    };
  }

  /** Raids this watch has in progress — for the status query. */
  activeRaids(): ActiveRaid[] {
    return this.#tracker.activeRaids();
  }
}
