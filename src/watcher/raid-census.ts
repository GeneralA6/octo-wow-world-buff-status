/**
 * Per-player occupancy census — the data foundation for temporal raid detection
 * and duration learning. It does NOT fire alerts; it observes each /who and records
 * when each character first appeared and last appeared, then reports arrivals and
 * departures. A departure carries how long the player stayed and when they arrived,
 * so a caller can spot a raid leaving (a cluster of similar-duration, similar-arrival
 * departures) and, over time, learn how long raids take.
 *
 * A player missing from a single /who is not treated as gone — only after a grace
 * period — so /who variance and the world client's brief reconnects don't register
 * as false departures (which would also corrupt durations).
 */

export interface DepartedPlayer {
  readonly name: string;
  readonly firstSeen: number;
  readonly stayedMs: number;
}

export interface CensusChange {
  readonly now: number;
  /** Players present in this /who (the raw count). */
  readonly present: number;
  readonly arrived: readonly string[];
  readonly departed: readonly DepartedPlayer[];
}

interface Seen {
  firstSeen: number;
  lastSeen: number;
}

const DEFAULT_GRACE_MS = 120_000; // ~2 poll intervals

export class RaidCensus {
  readonly #players = new Map<string, Seen>();
  readonly #graceMs: number;

  constructor(graceMs: number = DEFAULT_GRACE_MS) {
    this.#graceMs = graceMs;
  }

  /** Names currently believed present (seen within the grace window). */
  get tracked(): number {
    return this.#players.size;
  }

  /** Fold one /who snapshot in, returning who arrived and who has now departed. */
  observe(names: readonly string[], now: number): CensusChange {
    const present = new Set(names);
    const arrived: string[] = [];

    for (const name of names) {
      const seen = this.#players.get(name);
      if (seen) seen.lastSeen = now;
      else {
        this.#players.set(name, { firstSeen: now, lastSeen: now });
        arrived.push(name);
      }
    }

    const departed: DepartedPlayer[] = [];
    for (const [name, seen] of this.#players) {
      if (!present.has(name) && now - seen.lastSeen > this.#graceMs) {
        departed.push({ name, firstSeen: seen.firstSeen, stayedMs: seen.lastSeen - seen.firstSeen });
        this.#players.delete(name);
      }
    }

    return { now, present: names.length, arrived, departed };
  }
}

export interface DepartureSummary {
  readonly count: number;
  readonly minStayMs: number;
  readonly maxStayMs: number;
  readonly medianStayMs: number;
  /** Spread of arrival times among the leavers — small means they came in together. */
  readonly arrivalSpanMs: number;
}

/** Summarise a batch of departures — the shape that reveals a raid leaving together. */
export function summarizeDepartures(departed: readonly DepartedPlayer[]): DepartureSummary | null {
  if (departed.length === 0) return null;
  const stays = departed.map((d) => d.stayedMs).sort((a, b) => a - b);
  const firsts = departed.map((d) => d.firstSeen);
  return {
    count: departed.length,
    minStayMs: stays[0] ?? 0,
    maxStayMs: stays[stays.length - 1] ?? 0,
    medianStayMs: stays[Math.floor(stays.length / 2)] ?? 0,
    arrivalSpanMs: Math.max(...firsts) - Math.min(...firsts),
  };
}
