import { summarizeDepartures, type PresenceChange } from "./presence.js";
import type { ActiveRaid, RaidEvent } from "./raid-tracker.js";

/**
 * Temporal raid detection (step 2) — reads raids from WHEN players arrive and leave
 * rather than from the head count, so it works on a lair that never empties.
 *
 *   - FORMING: recent arrivals (within `formWindowMs`, minus any who've left) reach
 *     `formAt`. A cooldown then suppresses re-firing while that same raid keeps
 *     growing, so a raid swelling 15 → 25 doesn't announce twice.
 *   - LEFT: a batch of departures that ARRIVED together (≥ `leaveClusterSize`, within
 *     `arrivalSpanMaxMs`) — the sharp "a raid just cleared out together" signal.
 *
 * Emits the same RaidEvent shape as the count tracker, so delivery is unchanged.
 * Departure detection lags by the census grace window (~2 min) by nature. Windows
 * are tunable and meant to be calibrated on real cycles.
 */
export interface RaidSessionsOptions {
  readonly formAt: number;
  readonly formWindowMs?: number;
  readonly leaveClusterSize?: number;
  readonly arrivalSpanMaxMs?: number;
}

interface Session {
  readonly id: number;
  readonly formedAt: number;
  peak: number;
}

const DEFAULT_FORM_WINDOW_MS = 20 * 60_000;
const DEFAULT_ARRIVAL_SPAN_MAX_MS = 30 * 60_000;

export class RaidSessions {
  readonly #formAt: number;
  readonly #formWindowMs: number;
  readonly #leaveClusterSize: number;
  readonly #arrivalSpanMaxMs: number;
  readonly #forming = new Map<string, number>(); // name -> firstSeen
  #active: Session[] = [];
  #lastFormedAt = Number.NEGATIVE_INFINITY;
  #nextId = 1;

  constructor(options: RaidSessionsOptions) {
    this.#formAt = options.formAt;
    this.#formWindowMs = options.formWindowMs ?? DEFAULT_FORM_WINDOW_MS;
    this.#leaveClusterSize = options.leaveClusterSize ?? Math.max(2, Math.ceil(options.formAt * 0.6));
    this.#arrivalSpanMaxMs = options.arrivalSpanMaxMs ?? DEFAULT_ARRIVAL_SPAN_MAX_MS;
  }

  /** Raids believed in progress — for status and (later) duration heads-ups. */
  activeRaids(): ActiveRaid[] {
    return this.#active.map((session) => ({ label: "a raid", count: session.peak, peak: session.peak }));
  }

  update(change: PresenceChange): RaidEvent[] {
    if (change.blackout) {
      this.#forming.clear();
      this.#active = [];
      return [];
    }

    const now = change.now;
    const events: RaidEvent[] = [];

    // Forming pool: recent arrivals, minus anyone who left or has been around too long.
    for (const arrival of change.arrivals) this.#forming.set(arrival.name, now);
    for (const departure of change.departures) this.#forming.delete(departure.name);
    for (const [name, firstSeen] of this.#forming) {
      if (now - firstSeen > this.#formWindowMs) this.#forming.delete(name);
    }

    if (this.#forming.size >= this.#formAt && now - this.#lastFormedAt >= this.#formWindowMs) {
      const firstSeens = [...this.#forming.values()];
      const session: Session = { id: this.#nextId++, formedAt: Math.min(...firstSeens), peak: this.#forming.size };
      this.#active.push(session);
      this.#lastFormedAt = now;
      events.push({
        kind: "raid-forming",
        initial: false,
        cohort: {
          key: `s${session.id}`,
          label: "a raid",
          count: session.peak,
          peak: session.peak,
          members: [...this.#forming.keys()],
        },
      });
      this.#forming.clear();
    }

    // Leaving: a CONFIDENT departure cluster whose members arrived together. Only
    // confident departures count — a truncated view or hard-timeout eviction never
    // fires a raid-left.
    const confident = change.departures.filter((departure) => departure.confident);
    const summary = summarizeDepartures(confident);
    if (summary && summary.count >= this.#leaveClusterSize && summary.arrivalSpanMs <= this.#arrivalSpanMaxMs) {
      const session = this.#active.shift();
      const peak = session ? Math.max(session.peak, summary.count) : summary.count;
      events.push({
        kind: "raid-left",
        cohort: {
          key: session ? `s${session.id}` : "s?",
          label: "a raid",
          count: 0,
          peak,
          members: confident.map((departure) => departure.name),
        },
        // form → clear duration, for the self-improving timer (only when we saw it form).
        ...(session ? { durationMs: now - session.formedAt } : {}),
      });
    }

    return events;
  }
}
