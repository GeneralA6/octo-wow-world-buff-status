/**
 * Measures how long a raid actually takes to clear Onyxia — the ground truth for the
 * self-improving timer, and the trigger for the "raid ended / about to clear" alerts — by
 * tracking the RAID'S MEMBERS, not just the head count.
 *
 * What the /who count really does (measured 2026-08-31 on a live raid):
 *   - a raid holds a PLATEAU (~30) for long stretches,
 *   - it WIPES: the count crashes to 5–13 for 2–4 min, then recovers as everyone runs
 *     back (/who does NOT show them while dead / on the corpse run),
 *   - it CLEARS only when the members drop out and STAY out — nobody runs back.
 *
 * ARRIVAL COHORT (measured 2026-09-03): a raid assembles fast — median 2 min, p90 5 min — and
 * the next raid is ~30+ min behind it. So a raid IS the players who showed up together around
 * formation. On a busy server the lair never empties (one raid clears as the next forms), so an
 * absorb-everyone roster merges consecutive raids into one endless session that never clears
 * (measured: 2 clears detected in 14h of ~10). The fix: absorb a newcomer into the tracked raid
 * ONLY if they FIRST appeared within `fillWindowMs` of formation (and the roster is under
 * `rosterCap`). Someone arriving well after that is a different raid and is left for the NEXT
 * formation — so the current raid's departure is detected even while the lair stays full.
 *
 * A player's first-seen resets after an absence longer than `stintGapMs` (longer than a corpse
 * run, shorter than the gap between raids), so a wipe-returner keeps their place but someone who
 * left and comes back for a later raid counts as a fresh arrival.
 *
 * A departure is a clear only once cohort-present stays below strength for `sustainedMs` (a wipe
 * recovers well inside that). A blackout (our DC or a server outage) discards the in-progress
 * measurement rather than reading the mass drop as an instant clear.
 */
export interface ClearTrackerOptions {
  /** A raid is present once this many players are in the zone. */
  readonly formAt: number;
  /** Below this many of the ROSTER present, the raid is "not present" (a wipe trough or a
   *  real departure). Default: formAt. */
  readonly clearFloor?: number;
  /** Roster members must stay below `clearFloor` this long to confirm a clear (not a wipe). */
  readonly sustainedMs: number;
  /** A newcomer joins the tracked raid only if they first appeared within this long of formation.
   *  Measured raid assembly is median 2 min / p90 5 min. Default 5 min. */
  readonly fillWindowMs?: number;
  /** The tracked roster never grows past this — a backstop against absorbing a second raid.
   *  Default 30 (about one raid's worth). */
  readonly rosterCap?: number;
  /** A player absent longer than this has their first-seen reset on return (so a returner for a
   *  later raid is a fresh arrival, not a stale early one). Longer than a corpse run, shorter than
   *  the gap between raids. Default max(8 min, 2× sustained). */
  readonly stintGapMs?: number;
  /** Assigns the next monotonic raid number when a raid forms. Omit to leave raids unnumbered. */
  readonly nextNumber?: () => number;
}

export interface ConfirmedClear {
  /** form → the departure that stuck (spans any wipes in between). */
  readonly durationMs: number;
  /** The plateau peak — the true raid size, not a wipe trough. */
  readonly peak: number;
  /** The raid's reference number, or null if numbering isn't configured. */
  readonly number: number | null;
}

/** A raid just reached strength this poll — the first moment it has a reference number. The
 *  "a raid has formed" alert fires from this (not the detector's lower forming threshold, where
 *  no number exists yet), so the alert can name the raid the same #N the clear will. */
export interface FormedRaid {
  readonly number: number | null;
  readonly peak: number;
}

/** What one `observe` poll produced: a confirmed clear, a fresh formation, or neither (the
 *  usual case — a raid still in progress). A single poll never both forms and clears. */
export interface ClearObservation {
  readonly clear: ConfirmedClear | null;
  readonly formed: FormedRaid | null;
}

/**
 * A departure we've DETECTED (the roster fell below the clear floor) but not yet confirmed — it
 * is still inside the sustained-wait window, so it could still be a wipe. Exposed so the caller
 * can seek independent proof (a Chronicle kill log by one of this roster) and, if found, confirm
 * early via `confirmNow` instead of waiting the window out. Never produced without our own
 * detection first: Chronicle is confirmation ON TOP of the departure, never the trigger.
 */
export interface PendingDeparture {
  readonly roster: readonly string[];
  readonly number: number | null;
  readonly peak: number;
  readonly formedAt: number;
  readonly belowSince: number;
}

/** A tracked raid's full state, so it survives a restart (persisted to the DB). Only ever
 *  produced while a raid is in progress; the tracker resumes exactly where it left off. */
export interface ClearTrackerState {
  readonly formedAt: number;
  readonly number: number | null;
  readonly roster: readonly string[];
  readonly peak: number;
  readonly belowSince: number | null;
}

const DEFAULT_FILL_WINDOW_MS = 5 * 60_000;
const DEFAULT_ROSTER_CAP = 30;

export class ClearTracker {
  readonly #formAt: number;
  readonly #clearFloor: number;
  readonly #sustainedMs: number;
  readonly #fillWindowMs: number;
  readonly #rosterCap: number;
  readonly #stintGapMs: number;
  readonly #nextNumber?: () => number;

  #formedAt: number | null = null;
  #number: number | null = null;
  #roster = new Set<string>(); // this raid's members — the arrival cohort, capped, not everyone present
  #peak = 0;
  #belowSince: number | null = null; // when the roster's presence first fell below strength
  // Lair-wide arrival tracking, used to decide who belongs to the current raid. Persists across
  // raids (a clear resets the raid, not this); only a blackout clears it.
  #firstSeen = new Map<string, number>();
  #lastSeen = new Map<string, number>();

  constructor(options: ClearTrackerOptions) {
    this.#formAt = options.formAt;
    this.#clearFloor = options.clearFloor ?? options.formAt;
    this.#sustainedMs = options.sustainedMs;
    this.#fillWindowMs = options.fillWindowMs ?? DEFAULT_FILL_WINDOW_MS;
    this.#rosterCap = options.rosterCap ?? DEFAULT_ROSTER_CAP;
    this.#stintGapMs = options.stintGapMs ?? Math.max(8 * 60_000, options.sustainedMs * 2);
    this.#nextNumber = options.nextNumber;
  }

  /** True while a raid is being tracked (formed, not yet cleared). */
  get tracking(): boolean {
    return this.#formedAt !== null;
  }

  /** The current raid's reference number, or null if none is tracked / numbering is off. */
  get number(): number | null {
    return this.#number;
  }

  /** A snapshot of the raid in progress for persistence, or null if none is being tracked. */
  snapshot(): ClearTrackerState | null {
    if (this.#formedAt === null) return null;
    return {
      formedAt: this.#formedAt,
      number: this.#number,
      roster: [...this.#roster],
      peak: this.#peak,
      belowSince: this.#belowSince,
    };
  }

  /** Resume a persisted raid (after a restart), so its exit is still detected and it keeps
   *  its number/form-time. Ignored if a raid is already being tracked. */
  restore(state: ClearTrackerState): void {
    if (this.#formedAt !== null) return;
    this.#formedAt = state.formedAt;
    this.#number = state.number;
    this.#roster = new Set(state.roster);
    this.#peak = state.peak;
    this.#belowSince = state.belowSince;
  }

  /** How long the tracked raid has been in (form → now, spanning wipes), or null if none. */
  elapsedMs(now: number): number | null {
    return this.#formedAt === null ? null : now - this.#formedAt;
  }

  /**
   * A departure detected but not yet confirmed (roster below the floor, still inside the
   * sustained-wait window), or null. If `observe` just confirmed and reset this poll, this is
   * null — so it only ever reports a departure that is genuinely still waiting.
   */
  pending(): PendingDeparture | null {
    if (this.#formedAt === null || this.#belowSince === null) return null;
    return {
      roster: [...this.#roster],
      number: this.#number,
      peak: this.#peak,
      formedAt: this.#formedAt,
      belowSince: this.#belowSince,
    };
  }

  /**
   * Confirm a pending departure NOW, skipping the rest of the sustained wait — for when
   * independent proof (a Chronicle kill) shows the raid really finished. Returns the same
   * ConfirmedClear the wait would have produced (duration form → departure-start) and resets.
   * Null if no departure is pending: it can never manufacture a clear on its own.
   */
  confirmNow(): ConfirmedClear | null {
    if (this.#formedAt === null || this.#belowSince === null) return null;
    const clear: ConfirmedClear = {
      durationMs: this.#belowSince - this.#formedAt,
      peak: this.#peak,
      number: this.#number,
    };
    this.#reset();
    return clear;
  }

  /**
   * Feed one poll's players (names in the watched zone). Reports a fresh formation the poll a
   * raid first reaches strength (`formed`), and a ConfirmedClear the poll a sustained departure
   * is confirmed (`clear`) — never both in one poll. `blackout` discards whatever was in progress.
   */
  observe(names: readonly string[], now: number, blackout: boolean): ClearObservation {
    if (blackout) {
      // We went blind (our DC or a server outage) — anything across it is untrustworthy.
      this.#reset();
      this.#firstSeen.clear();
      this.#lastSeen.clear();
      return { clear: null, formed: null };
    }

    this.#trackArrivals(names, now);

    if (this.#formedAt === null) {
      if (names.length >= this.#formAt) {
        this.#formedAt = now;
        this.#number = this.#nextNumber?.() ?? null;
        this.#roster = new Set(names.slice(0, this.#rosterCap));
        this.#peak = this.#roster.size;
        this.#belowSince = null;
        return { clear: null, formed: { number: this.#number, peak: this.#peak } };
      }
      return { clear: null, formed: null };
    }

    // Absorb NEWCOMERS into this raid only if they arrived within the fill window of formation
    // (and the roster is under the cap). Someone who first appeared long after formation is a
    // different raid — leaving them out is what lets this raid's departure register while the
    // lair stays full of the next one.
    const fillDeadline = this.#formedAt + this.#fillWindowMs;
    for (const name of names) {
      if (this.#roster.has(name) || this.#roster.size >= this.#rosterCap) continue;
      if ((this.#firstSeen.get(name) ?? now) <= fillDeadline) this.#roster.add(name);
    }

    // How many of THIS raid's members are visible now (ambient/new arrivals don't count).
    let cohort = 0;
    for (const name of names) if (this.#roster.has(name)) cohort += 1;

    if (cohort >= this.#clearFloor) {
      // Up, or recovered from a wipe (the same members are back).
      if (cohort > this.#peak) this.#peak = cohort;
      this.#belowSince = null;
      return { clear: null, formed: null };
    }

    // The roster has mostly dropped out — a wipe or a real departure.
    if (this.#belowSince === null) {
      this.#belowSince = now;
      return { clear: null, formed: null };
    }
    if (now - this.#belowSince >= this.#sustainedMs) {
      const clear: ConfirmedClear = {
        durationMs: this.#belowSince - this.#formedAt,
        peak: this.#peak,
        number: this.#number,
      };
      this.#reset();
      return { clear, formed: null };
    }
    return { clear: null, formed: null }; // still within the window — the roster could yet run back (a wipe)
  }

  /** Record when each present player was first seen (their arrival), resetting anyone who
   *  returns after an absence longer than a stint gap, and pruning players long gone. */
  #trackArrivals(names: readonly string[], now: number): void {
    for (const name of names) {
      const last = this.#lastSeen.get(name);
      if (last === undefined || now - last > this.#stintGapMs) this.#firstSeen.set(name, now);
      this.#lastSeen.set(name, now);
    }
    const present = new Set(names);
    for (const [name, last] of this.#lastSeen) {
      // Keep current roster members regardless (a hard wipe can hide them); drop long-gone others.
      if (!present.has(name) && now - last > this.#stintGapMs && !this.#roster.has(name)) {
        this.#lastSeen.delete(name);
        this.#firstSeen.delete(name);
      }
    }
  }

  #reset(): void {
    this.#formedAt = null;
    this.#number = null;
    this.#roster = new Set();
    this.#peak = 0;
    this.#belowSince = null;
  }
}
