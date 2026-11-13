/**
 * Detects raid clears from DEPARTURE BURSTS instead of tracking one raid at a time, so any number of
 * raids sharing a lair are each seen to leave.
 *
 * Measured on production snapshots (2026-11-13: 1 day of Blackwing Lair, 7 days of Onyxia): a raid's
 * members arrive interleaved with other raids' (an evening BWL had 6-7 raids arrive within 30 min of
 * each other), but they LEAVE together — a block of ~18-29 players within 2-6 minutes, who don't come
 * back. Wipes look like a departure too, but the run-back returns inside a few minutes (BWL max 7.3m).
 *
 * The rule: when at least `minGroup` players who had each been in the lair for `minStayMs` or more
 * were all last seen within `spanMs` of each other, and every one of them has stayed gone for
 * `sustainedMs`, that block is one cleared raid. Replay against Chronicle kill logs: Onyxia caught
 * 44/49 kills (the single-raid tracker 39/49) with no clear whose leavers came back; BWL found all 11
 * departures with none false.
 *
 * The same per-player stays drive the "about to clear" heads-up: once `minGroup` players still in the
 * lair have each been in for the warning threshold, that block is warned once — no need to know which
 * raid they belong to.
 *
 * Pure: time comes in with each observation, so tests drive it with plain numbers.
 */
export interface DepartureSettings {
  /** Only a player in the lair at least this long counts toward a clear (a passer-by doesn't). */
  readonly minStayMs: number;
  /** How many such players must leave together for it to be a raid clearing. */
  readonly minGroup: number;
  /** How long they must all stay gone, so a wipe's run-back isn't read as a clear. */
  readonly sustainedMs: number;
}

export interface DepartureDetectorOptions extends DepartureSettings {
  /** The widest gap between the first and last of one departing block. Default 5 min. */
  readonly spanMs?: number;
  /** A departure older than `sustainedMs + lookbackMs` is history, never reported late. Default 15 min. */
  readonly lookbackMs?: number;
}

/** One poll of the lair: who is in it, and whether the /who listed everyone. */
export interface DepartureObservation {
  readonly names: readonly string[];
  /** False when the /who was truncated — absent players may only be unlisted, so nothing is concluded. */
  readonly complete: boolean;
  readonly at: number;
}

/** A block of players that left together: one raid's clear. */
export interface DepartedGroup {
  readonly size: number;
  readonly firstLeftAt: number;
  readonly lastLeftAt: number;
  /** The median time its members had been in the lair: the raid's clear duration. */
  readonly medianStayMs: number;
}

/** A block of players still in the lair who have now been in long enough to warn about. */
export interface DueGroup {
  readonly size: number;
  readonly medianStayMs: number;
}

const DEFAULT_SPAN_MS = 5 * 60_000;
const DEFAULT_LOOKBACK_MS = 15 * 60_000;
/** An absence longer than a corpse run starts a new stay; never shorter than this. */
const MIN_STINT_GAP_MS = 8 * 60_000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
}

interface Stay {
  firstSeen: number;
  lastSeen: number;
}

export class DepartureDetector {
  readonly #minStayMs: number;
  readonly #minGroup: number;
  readonly #sustainedMs: number;
  readonly #spanMs: number;
  readonly #lookbackMs: number;
  readonly #stintGapMs: number;
  /** Each player's current stay in the lair; pruned once it can no longer matter. */
  readonly #stays = new Map<string, Stay>();
  /** Players already counted in a clear during their current stay. */
  readonly #departed = new Set<string>();
  /** Players already covered by a heads-up during their current stay. */
  readonly #warned = new Set<string>();
  #present = new Set<string>();

  constructor(options: DepartureDetectorOptions) {
    this.#minStayMs = options.minStayMs;
    this.#minGroup = options.minGroup;
    this.#sustainedMs = options.sustainedMs;
    this.#spanMs = options.spanMs ?? DEFAULT_SPAN_MS;
    this.#lookbackMs = options.lookbackMs ?? DEFAULT_LOOKBACK_MS;
    // Longer than the wait, so a player gone for the whole wait is still on the same stay when judged.
    this.#stintGapMs = Math.max(MIN_STINT_GAP_MS, options.sustainedMs + 60_000);
  }

  /** Feeds one poll; returns every raid that has now cleared (usually none, sometimes several). */
  observe(observation: DepartureObservation): DepartedGroup[] {
    const { names, complete, at } = observation;
    for (const name of names) {
      const stay = this.#stays.get(name);
      if (stay === undefined || at - stay.lastSeen > this.#stintGapMs) {
        this.#stays.set(name, { firstSeen: at, lastSeen: at });
        this.#departed.delete(name);
        this.#warned.delete(name);
      } else {
        stay.lastSeen = at;
      }
    }
    this.#present = new Set(names);
    this.#prune(at);
    return complete ? this.#takeDepartures(at) : [];
  }

  /**
   * The heads-up check: if at least `minGroup` players still in the lair (as of the last poll) have
   * each been in for `thresholdMs` and weren't warned about yet, marks them warned and returns them.
   */
  dueForWarning(at: number, thresholdMs: number): DueGroup | null {
    const stays: number[] = [];
    const names: string[] = [];
    for (const name of this.#present) {
      const stay = this.#stays.get(name);
      if (stay === undefined || this.#warned.has(name)) continue;
      const stayedMs = at - stay.firstSeen;
      if (stayedMs >= thresholdMs) {
        stays.push(stayedMs);
        names.push(name);
      }
    }
    if (names.length < this.#minGroup) return null;
    for (const name of names) this.#warned.add(name);
    return { size: names.length, medianStayMs: median(stays) };
  }

  #takeDepartures(at: number): DepartedGroup[] {
    const candidates: { name: string; lastSeen: number; stayMs: number }[] = [];
    for (const [name, stay] of this.#stays) {
      if (this.#departed.has(name)) continue;
      const goneMs = at - stay.lastSeen;
      const stayMs = stay.lastSeen - stay.firstSeen;
      if (goneMs >= this.#sustainedMs && goneMs < this.#sustainedMs + this.#lookbackMs && stayMs >= this.#minStayMs) {
        candidates.push({ name, lastSeen: stay.lastSeen, stayMs });
      }
    }
    candidates.sort((a, b) => a.lastSeen - b.lastSeen);

    const groups: DepartedGroup[] = [];
    for (;;) {
      const block = this.#densestBlock(candidates);
      if (block.length < this.#minGroup) return groups;
      for (const member of block) {
        this.#departed.add(member.name);
        candidates.splice(candidates.indexOf(member), 1);
      }
      groups.push({
        size: block.length,
        firstLeftAt: block[0]!.lastSeen,
        lastLeftAt: block[block.length - 1]!.lastSeen,
        medianStayMs: median(block.map((member) => member.stayMs)),
      });
    }
  }

  /** The largest run of candidates (sorted by last seen) all within `spanMs` of each other. */
  #densestBlock<T extends { lastSeen: number }>(sorted: readonly T[]): T[] {
    let best: T[] = [];
    for (let start = 0, end = 0; end < sorted.length; end += 1) {
      while (sorted[end]!.lastSeen - sorted[start]!.lastSeen > this.#spanMs) start += 1;
      if (end - start + 1 > best.length) best = sorted.slice(start, end + 1);
    }
    return best;
  }

  /** Forgets players gone so long they can neither be reported nor continue their stay. */
  #prune(at: number): void {
    const keepMs = Math.max(this.#stintGapMs, this.#sustainedMs + this.#lookbackMs);
    for (const [name, stay] of this.#stays) {
      if (at - stay.lastSeen > keepMs) {
        this.#stays.delete(name);
        this.#departed.delete(name);
        this.#warned.delete(name);
      }
    }
  }
}
