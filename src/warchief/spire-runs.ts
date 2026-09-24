import { factionOfRace } from "../watcher/faction.js";
import { spirePlayer, type SpirePlayer, type SpireView } from "./spire-view.js";

/**
 * Finds Upper Blackrock Spire runs in the Spire's `/who` readings — the raids that can kill Rend and
 * so drop the Warchief's Blessing — and says when each one leaves.
 *
 * `/who` puts LBRS parties and UBRS raids in the one zone with no group id, so a run is inferred from
 * WHEN players came in: a raid gathers at the meeting stone and walks in together, so players whose
 * arrivals chain within `linkGapMs` of each other are one cohort, and a cohort of at least
 * `minRunSize` is too big to be a five-man party. A later arrival within `joinGapMs` of a run's last
 * one fills it (a late summon), up to `maxRunSize`. The run has ended once fewer than `leftFraction`
 * of its peak are still inside and that has held for `endSustainedMs` — longer than a wipe's run back.
 *
 * Deliberately a first cut, tuned by replaying the recorded readings against the blessings actually
 * heard; the options are the knobs that replay turns. Pure and clock-free: time is the readings' own.
 */

export interface SpireRunOptions {
  /** Co-arriving players it takes to call a cohort a raid — an LBRS party is five. */
  readonly minRunSize: number;
  /** Two arrivals this close belong to one cohort (single linkage, along the arrival order). */
  readonly linkGapMs: number;
  /** A later arrival joins a run under way if it came within this of the run's latest arrival. */
  readonly joinGapMs: number;
  /** A run's roster never grows past this — a backstop against swallowing a party that came in after. */
  readonly maxRunSize: number;
  /** The run is leaving once fewer than this share of its peak are still inside. */
  readonly leftFraction: number;
  /** ...and has ended once that has held this long. */
  readonly endSustainedMs: number;
  /** A player missing from complete readings this long has left the Spire. */
  readonly graceMs: number;
  /** A player missing this long is forgotten even when the readings are incomplete, to bound memory. */
  readonly forgetMs: number;
  /** A gap between readings longer than this blinds the tracker: it starts over from what it sees. */
  readonly blackoutMs: number;
  /** A run still inside after this long is idlers, not a raid — it is ended as stale. */
  readonly maxRunMs: number;
}

export const DEFAULT_SPIRE_RUN_OPTIONS: SpireRunOptions = {
  minRunSize: 8,
  linkGapMs: 5 * 60_000,
  joinGapMs: 10 * 60_000,
  maxRunSize: 15,
  leftFraction: 0.4,
  endSustainedMs: 5 * 60_000,
  graceMs: 3 * 60_000,
  forgetMs: 20 * 60_000,
  blackoutMs: 5 * 60_000,
  maxRunMs: 3 * 60 * 60_000,
};

export interface SpireRun {
  readonly id: number;
  /** The earliest arrival among the cohort that formed it. */
  readonly startedAt: number;
  /** The reading it was recognised on. */
  readonly formedAt: number;
  readonly roster: readonly SpirePlayer[];
  /** The most of its roster ever inside at once. */
  readonly peak: number;
  /** Formed from players already inside when the tracker began or came back from a blind gap —
   *  their arrival times are when we first looked, not when they came in. */
  readonly baseline: boolean;
}

/** `left`: its roster walked out. `stale`: still inside past `maxRunMs`. `blind`: gone across a gap
 *  in the readings, so `endedAt` is only the last time it was seen at strength. */
export type SpireRunEndReason = "left" | "stale" | "blind";

export type SpireRunEvent =
  | { readonly kind: "run-started"; readonly run: SpireRun }
  | {
      readonly kind: "run-ended";
      readonly run: SpireRun;
      readonly endedAt: number;
      readonly reason: SpireRunEndReason;
    };

/** How many of a run's roster are Horde — only a Horde player can turn Rend's head in to Thrall. */
export function hordeMembers(roster: readonly SpirePlayer[]): number {
  return roster.filter((player) => factionOfRace(player.raceId) === "horde").length;
}

interface Seen {
  player: SpirePlayer;
  firstSeen: number;
  lastSeen: number;
  /** False when first seen on a first look or after a blind gap — `firstSeen` is when we looked. */
  arrivalObserved: boolean;
  /** The run this player belongs to — active, or ended while they lingered — or null if free. */
  runId: number | null;
}

interface ActiveRun {
  readonly id: number;
  readonly startedAt: number;
  readonly formedAt: number;
  readonly baseline: boolean;
  readonly roster: Map<string, SpirePlayer>;
  lastArrivalAt: number;
  peak: number;
  /** The last reading with the run at or above its leaving floor. */
  lastStrongAt: number;
  /** The first reading of the current stretch below the floor, or null while it holds. */
  belowSince: number | null;
}

export class SpireRunTracker {
  readonly #options: SpireRunOptions;
  readonly #seen = new Map<string, Seen>();
  readonly #runs = new Map<number, ActiveRun>();
  #nextId = 1;
  #lastAt: number | null = null;
  #lastComplete = false;

  constructor(options: SpireRunOptions = DEFAULT_SPIRE_RUN_OPTIONS) {
    this.#options = options;
  }

  observe(view: SpireView): SpireRunEvent[] {
    const at = view.at;
    const blind = this.#lastAt !== null && at - this.#lastAt > this.#options.blackoutMs;
    const baseline = this.#lastAt === null || blind;
    this.#lastAt = at;

    const present = new Set(view.present.map((player) => player.name));
    const events: SpireRunEvent[] = [];
    if (blind) events.push(...this.#endUnseenAfterGap(present));
    this.#note(view, baseline);
    this.#forgetDeparted(at, view.complete && this.#lastComplete);
    this.#lastComplete = view.complete;
    this.#fillRuns();
    events.push(...this.#formRuns(at));
    events.push(...this.#progressRuns(present, at, view.complete));
    return events;
  }

  /** The runs under way, for attributing a blessing heard mid-run. */
  activeRuns(): SpireRun[] {
    return [...this.#runs.values()].map((run) => this.#summary(run));
  }

  #note(view: SpireView, baseline: boolean): void {
    for (const player of view.present) {
      const known = this.#seen.get(player.name);
      if (known) {
        known.player = spirePlayer(player);
        known.lastSeen = view.at;
        continue;
      }
      // A roster member back from a wipe's run back (or a hearth and return) is still that run's.
      const run = [...this.#runs.values()].find((active) => active.roster.has(player.name));
      this.#seen.set(player.name, {
        player: spirePlayer(player),
        firstSeen: view.at,
        lastSeen: view.at,
        arrivalObserved: !baseline,
        runId: run?.id ?? null,
      });
    }
  }

  #forgetDeparted(at: number, trustworthy: boolean): void {
    for (const [name, seen] of this.#seen) {
      const absent = at - seen.lastSeen;
      if (absent === 0) continue;
      if ((trustworthy && absent > this.#options.graceMs) || absent > this.#options.forgetMs) {
        this.#seen.delete(name);
      }
    }
  }

  /** Late arrivals join the run they came in behind, if it still has room and is not leaving. */
  #fillRuns(): void {
    for (const seen of this.#free()) {
      const run = [...this.#runs.values()]
        .filter(
          (active) =>
            active.belowSince === null &&
            active.roster.size < this.#options.maxRunSize &&
            seen.firstSeen >= active.startedAt &&
            seen.firstSeen - active.lastArrivalAt <= this.#options.joinGapMs,
        )
        .sort((a, b) => b.lastArrivalAt - a.lastArrivalAt)[0];
      if (!run) continue;
      run.roster.set(seen.player.name, seen.player);
      run.lastArrivalAt = Math.max(run.lastArrivalAt, seen.firstSeen);
      seen.runId = run.id;
    }
  }

  /** Chains the free players by arrival time; every chain big enough to be a raid becomes a run. */
  #formRuns(at: number): SpireRunEvent[] {
    const free = this.#free();
    const cohorts: Seen[][] = [];
    for (const seen of free) {
      const current = cohorts[cohorts.length - 1];
      const last = current?.[current.length - 1];
      if (current && last && seen.firstSeen - last.firstSeen <= this.#options.linkGapMs) current.push(seen);
      else cohorts.push([seen]);
    }
    const events: SpireRunEvent[] = [];
    for (const cohort of cohorts) {
      if (cohort.length < this.#options.minRunSize) continue;
      const members = cohort.slice(0, this.#options.maxRunSize);
      const first = members[0]!;
      const run: ActiveRun = {
        id: this.#nextId++,
        startedAt: first.firstSeen,
        formedAt: at,
        baseline: members.some((seen) => !seen.arrivalObserved),
        roster: new Map(members.map((seen) => [seen.player.name, seen.player])),
        lastArrivalAt: members[members.length - 1]!.firstSeen,
        peak: members.length,
        lastStrongAt: at,
        belowSince: null,
      };
      for (const seen of members) seen.runId = run.id;
      this.#runs.set(run.id, run);
      events.push({ kind: "run-started", run: this.#summary(run) });
    }
    return events;
  }

  #progressRuns(present: ReadonlySet<string>, at: number, complete: boolean): SpireRunEvent[] {
    const events: SpireRunEvent[] = [];
    for (const run of [...this.#runs.values()]) {
      const inside = [...run.roster.keys()].filter((name) => present.has(name)).length;
      run.peak = Math.max(run.peak, inside);
      if (at - run.startedAt > this.#options.maxRunMs) {
        events.push(this.#end(run, at, "stale"));
        continue;
      }
      if (inside >= this.#floor(run)) {
        run.lastStrongAt = at;
        run.belowSince = null;
        continue;
      }
      // A truncated reading can hide members who are still inside — it never starts a departure.
      if (!complete) continue;
      run.belowSince ??= at;
      if (at - run.belowSince >= this.#options.endSustainedMs) events.push(this.#end(run, run.belowSince, "left"));
    }
    return events;
  }

  /** After a blind gap: a run still at strength carries on, one that is gone ended while we could not
   *  see — at some point after it was last seen at strength, which is the best we can say. */
  #endUnseenAfterGap(present: ReadonlySet<string>): SpireRunEvent[] {
    const events: SpireRunEvent[] = [];
    for (const run of [...this.#runs.values()]) {
      const inside = [...run.roster.keys()].filter((name) => present.has(name)).length;
      if (inside >= this.#floor(run)) continue;
      events.push(this.#end(run, run.lastStrongAt, "blind"));
    }
    return events;
  }

  #end(run: ActiveRun, endedAt: number, reason: SpireRunEndReason): SpireRunEvent {
    this.#runs.delete(run.id);
    return { kind: "run-ended", run: this.#summary(run), endedAt, reason };
  }

  #floor(run: ActiveRun): number {
    return Math.max(2, Math.ceil(run.peak * this.#options.leftFraction));
  }

  /** Free players, in arrival order. */
  #free(): Seen[] {
    return [...this.#seen.values()].filter((seen) => seen.runId === null).sort((a, b) => a.firstSeen - b.firstSeen);
  }

  #summary(run: ActiveRun): SpireRun {
    return {
      id: run.id,
      startedAt: run.startedAt,
      formedAt: run.formedAt,
      roster: [...run.roster.values()],
      peak: run.peak,
      baseline: run.baseline,
    };
  }
}
