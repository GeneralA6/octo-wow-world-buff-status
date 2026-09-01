/**
 * Measures how long a raid actually takes to clear Onyxia — the ground truth for the
 * self-improving timer — by tracking the RAID'S MEMBERS, not just the head count.
 *
 * What the /who count really does (measured 2026-08-31 on a live raid):
 *   - a raid holds a PLATEAU (~30) for long stretches,
 *   - it WIPES: the count crashes to 5–13 for 2–4 min, then recovers as everyone runs
 *     back (/who does NOT show them while dead / on the corpse run),
 *   - it CLEARS only when the members drop out and STAY out — nobody runs back.
 *
 * Tracking the roster (a set of names) is what lets us SYNC across a gap: a wipe is the
 * SAME members returning, so cohort-present recovers and the session continues; a real
 * clear is those members gone; and a different crowd arriving (a new raid, or ambient
 * traffic passing through the lair) does NOT keep the old raid "alive", because it isn't
 * the old roster. A departure is a clear only once cohort-present stays below strength for
 * `sustainedMs` (a wipe recovers well inside that). A blackout (our DC or a server outage)
 * discards the in-progress measurement rather than reading the mass drop as an instant clear.
 *
 * Deliberately conservative: most activity yields NO sample (still going, or discarded by a
 * blackout). What it yields is a real, completed clear, sized by the plateau peak.
 */
export interface ClearTrackerOptions {
  /** A raid is present once this many players are in the zone. */
  readonly formAt: number;
  /** Below this many of the ROSTER present, the raid is "not present" (a wipe trough or a
   *  real departure). Default: formAt. */
  readonly clearFloor?: number;
  /** Roster members must stay below `clearFloor` this long to confirm a clear (not a wipe). */
  readonly sustainedMs: number;
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

export class ClearTracker {
  readonly #formAt: number;
  readonly #clearFloor: number;
  readonly #sustainedMs: number;
  readonly #nextNumber?: () => number;

  #formedAt: number | null = null;
  #number: number | null = null;
  #roster = new Set<string>(); // everyone seen as part of this raid (grows; survives flicker)
  #peak = 0;
  #belowSince: number | null = null; // when the roster's presence first fell below strength

  constructor(options: ClearTrackerOptions) {
    this.#formAt = options.formAt;
    this.#clearFloor = options.clearFloor ?? options.formAt;
    this.#sustainedMs = options.sustainedMs;
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
      return { clear: null, formed: null };
    }

    if (this.#formedAt === null) {
      if (names.length >= this.#formAt) {
        this.#formedAt = now;
        this.#number = this.#nextNumber?.() ?? null;
        this.#roster = new Set(names);
        this.#peak = names.length;
        this.#belowSince = null;
        return { clear: null, formed: { number: this.#number, peak: this.#peak } };
      }
      return { clear: null, formed: null };
    }

    // How many of THIS raid's members are visible now (ambient/new arrivals don't count).
    let cohort = 0;
    for (const name of names) if (this.#roster.has(name)) cohort += 1;

    if (cohort >= this.#clearFloor) {
      // Up, or recovered from a wipe (the same members are back). Absorb the current crowd
      // as roster members (late joiners, and members /who has just re-acquired).
      for (const name of names) this.#roster.add(name);
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

  #reset(): void {
    this.#formedAt = null;
    this.#number = null;
    this.#roster = new Set();
    this.#peak = 0;
    this.#belowSince = null;
  }
}
