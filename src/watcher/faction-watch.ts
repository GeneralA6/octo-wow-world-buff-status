import type { WhoPlayer } from "../protocol/who.js";
import type { Faction } from "./buff-store.js";
import { PresenceTracker, type PresenceChange } from "./presence.js";
import { RaidSessions } from "./raid-sessions.js";
import { RaidTracker, type ActiveRaid, type GroupingMode, type RaidEvent } from "./raid-tracker.js";

/**
 * One faction's raid detection over its slice of the lair (c → per-faction).
 *
 * OctoWoW's /who returns both factions mixed, but a raid feeds only its own faction's
 * city buff, so each faction gets its own presence census and both detectors. Bundled
 * here so the per-faction state persists across reconnects and stays testable.
 *
 * Blackout (a long blind gap) is absorbed internally: every detector re-baselines and
 * no events fire, so a crash-and-refill isn't read as a raid starting or ending.
 */
export interface FactionWatchOptions {
  readonly minRaidSize: number;
  readonly grouping: GroupingMode;
  readonly clearSize: number;
}

export interface FactionObservation {
  readonly change: PresenceChange;
  readonly countEvents: readonly RaidEvent[];
  readonly temporalEvents: readonly RaidEvent[];
}

export class FactionWatch {
  readonly faction: Faction;
  readonly #presence = new PresenceTracker();
  readonly #tracker: RaidTracker;
  readonly #sessions: RaidSessions;

  constructor(faction: Faction, options: FactionWatchOptions) {
    this.faction = faction;
    this.#tracker = new RaidTracker(options.minRaidSize, options.grouping, options.clearSize);
    this.#sessions = new RaidSessions({ formAt: options.minRaidSize });
  }

  observe(players: readonly WhoPlayer[], now: number, complete: boolean): FactionObservation {
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

  /** Raids this faction has in progress — for the status query. */
  activeRaids(): ActiveRaid[] {
    return this.#tracker.activeRaids();
  }
}
