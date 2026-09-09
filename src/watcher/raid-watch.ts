import type { WhoPlayer } from "../protocol/who.js";
import {
  ClearTracker,
  type ClearTrackerState,
  type ConfirmedClear,
  type FormedRaid,
  type PendingDeparture,
} from "./clear-tracker.js";
import { PresenceTracker, type PresenceChange } from "./presence.js";
import { RaidSessions } from "./raid-sessions.js";
import { CohortDetector, type ActiveRaid, type GroupingMode, type RaidEvent } from "./cohort-detector.js";

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
  /** Members the raid must reach for the clear tracker to start following it (the duration
   *  clock's start). The forming alert fires earlier, at minRaidSize. Defaults to minRaidSize. */
  readonly strengthSize?: number;
  /** Below this many of the roster present, the raid is "leaving" (the clear floor). Held below
   *  the plateau so churn isn't read as a departure. Defaults to minRaidSize. */
  readonly leftFloor?: number;
  /** How long the roster must stay gone for a departure to count as a real clear (not a wipe). */
  readonly clearSustainedMs: number;
  /** A newcomer joins the tracked raid only if they first appeared within this long of formation
   *  (arrival-cohort separation). Defaults to the ClearTracker default (5 min). */
  readonly fillWindowMs?: number;
  /** The tracked roster never grows past this — a backstop against absorbing a second raid. */
  readonly rosterCap?: number;
  /** Assigns the next raid reference number when a raid forms. Omit to leave raids unnumbered. */
  readonly nextRaidNumber?: () => number;
}

export interface RaidObservation {
  readonly change: PresenceChange;
  readonly countEvents: readonly RaidEvent[];
  readonly temporalEvents: readonly RaidEvent[];
  /** A real, completed clear was confirmed this poll — the ground truth for the timer. */
  readonly clear: ConfirmedClear | null;
  /** A raid reached strength this poll (first got its number) — drives the "raid has formed" alert. */
  readonly formed: FormedRaid | null;
}

export class RaidWatch {
  readonly #presence = new PresenceTracker();
  readonly #tracker: CohortDetector;
  readonly #sessions: RaidSessions;
  readonly #clears: ClearTracker;

  constructor(options: RaidWatchOptions) {
    this.#tracker = new CohortDetector(options.minRaidSize, options.grouping, options.clearSize);
    this.#sessions = new RaidSessions({ formAt: options.minRaidSize });
    this.#clears = new ClearTracker({
      // The clock/tracking starts at "strength" (>= forming); the clear floor is the "leaving"
      // level, held below the plateau. Both default to minRaidSize (the original single-point).
      formAt: options.strengthSize ?? options.minRaidSize,
      clearFloor: options.leftFloor ?? options.minRaidSize,
      sustainedMs: options.clearSustainedMs,
      fillWindowMs: options.fillWindowMs,
      rosterCap: options.rosterCap,
      nextNumber: options.nextRaidNumber,
    });
  }

  observe(players: readonly WhoPlayer[], now: number, complete: boolean): RaidObservation {
    const names = players.map((player) => player.name);
    const change = this.#presence.observe(names, now, complete);
    if (change.blackout) {
      this.#tracker.rebaseline(players);
      this.#sessions.update(change); // clears its state on blackout too
      this.#clears.observe(names, now, true, complete); // discard any in-progress clear measurement
      return { change, countEvents: [], temporalEvents: [], clear: null, formed: null };
    }
    const clearObs = this.#clears.observe(names, now, false, complete);
    return {
      change,
      countEvents: this.#tracker.update(players),
      temporalEvents: this.#sessions.update(change),
      clear: clearObs.clear,
      formed: clearObs.formed,
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

  /** The reference number of the raid in progress, or null if none — for the status query. */
  raidNumber(): number | null {
    return this.#clears.number;
  }

  /** A departure we've detected but not yet confirmed (still inside the sustained wait), or
   *  null — so the caller can seek a Chronicle kill to confirm it early. */
  pendingClear(): PendingDeparture | null {
    return this.#clears.pending();
  }

  /** Confirm a pending departure now (Chronicle proved the kill), returning the same clear the
   *  wait would have produced, or null if none is pending. Never manufactures a clear. */
  confirmClearNow(): ConfirmedClear | null {
    return this.#clears.confirmNow();
  }

  /** The raid in progress as a persistable snapshot, or null — to survive a restart. */
  raidStateSnapshot(): ClearTrackerState | null {
    return this.#clears.snapshot();
  }

  /** Resume a persisted raid on startup, so a mid-raid restart still catches its exit. */
  restoreRaidState(state: ClearTrackerState): void {
    this.#clears.restore(state);
  }
}
