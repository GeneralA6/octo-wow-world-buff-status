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
}

export interface ConfirmedClear {
  /** form → the departure that stuck (spans any wipes in between). */
  readonly durationMs: number;
  /** The plateau peak — the true raid size, not a wipe trough. */
  readonly peak: number;
}

export class ClearTracker {
  readonly #formAt: number;
  readonly #clearFloor: number;
  readonly #sustainedMs: number;

  #formedAt: number | null = null;
  #roster = new Set<string>(); // everyone seen as part of this raid (grows; survives flicker)
  #peak = 0;
  #belowSince: number | null = null; // when the roster's presence first fell below strength

  constructor(options: ClearTrackerOptions) {
    this.#formAt = options.formAt;
    this.#clearFloor = options.clearFloor ?? options.formAt;
    this.#sustainedMs = options.sustainedMs;
  }

  /** True while a raid is being tracked (formed, not yet cleared). */
  get tracking(): boolean {
    return this.#formedAt !== null;
  }

  /** How long the tracked raid has been in (form → now, spanning wipes), or null if none. */
  elapsedMs(now: number): number | null {
    return this.#formedAt === null ? null : now - this.#formedAt;
  }

  /**
   * Feed one poll's players (names in the watched zone). Returns a ConfirmedClear the moment
   * a sustained departure of the roster is confirmed, else null. `blackout` discards whatever
   * was in progress.
   */
  observe(names: readonly string[], now: number, blackout: boolean): ConfirmedClear | null {
    if (blackout) {
      // We went blind (our DC or a server outage) — anything across it is untrustworthy.
      this.#reset();
      return null;
    }

    if (this.#formedAt === null) {
      if (names.length >= this.#formAt) {
        this.#formedAt = now;
        this.#roster = new Set(names);
        this.#peak = names.length;
        this.#belowSince = null;
      }
      return null;
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
      return null;
    }

    // The roster has mostly dropped out — a wipe or a real departure.
    if (this.#belowSince === null) {
      this.#belowSince = now;
      return null;
    }
    if (now - this.#belowSince >= this.#sustainedMs) {
      const clear: ConfirmedClear = { durationMs: this.#belowSince - this.#formedAt, peak: this.#peak };
      this.#reset();
      return clear;
    }
    return null; // still within the window — the roster could yet run back (a wipe)
  }

  #reset(): void {
    this.#formedAt = null;
    this.#roster = new Set();
    this.#peak = 0;
    this.#belowSince = null;
  }
}
