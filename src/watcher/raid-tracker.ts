import type { WhoPlayer } from "../protocol/who.js";

/**
 * Tracks distinct raids forming in a zone from a stream of /who snapshots.
 *
 * /who returns one flat list of everyone in the zone (all instances merged, capped
 * at 49 names) with no instance or raid-group id — so the only field that can tell
 * two concurrent raids apart is the guild tag, and even that fails for a pickup raid
 * whose members are scattered across many small guilds. Grouping copes with both:
 *
 *   - "auto"  (default): a guild that reaches the threshold is its own named raid;
 *                        everyone else — small guilds and the unguilded — pools into
 *                        one "pickup" cohort that forms its own raid at the threshold.
 *                        So a guild raid and a concurrent pickup raid are both seen.
 *   - "guild":           every guild is its own cohort; the unguilded share a bucket.
 *                        Misses a pickup raid spread thin across guilds.
 *   - "lair":            the whole zone is one raid. Simplest; never splits concurrents.
 *
 * Each cohort keeps its roster by name and reports two transitions, independently and
 * simultaneously:
 *
 *   - a cohort first reaching `formAt` members       => "raid-forming"
 *   - an active cohort dropping below `leaveAt`       => "raid-left" (then it re-arms)
 *
 * Once a cohort has formed it stays active through membership churn — a few members
 * leaving and rejoining is silent, and in "auto" mode a named guild raid stays named
 * even if it dips below the form threshold — until it drops below `leaveAt`, when it
 * reports "raid-left" and re-arms so the NEXT raid to fill the lair fires again (a
 * busy lair rarely empties to exactly zero, so a low floor is what re-arms it). The
 * very first poll sets a baseline: a cohort already at strength then reports
 * "raid-forming" with `initial: true` so a caller can word it "already in progress".
 *
 * Concurrent *pickup* raids still can't be separated from each other — no /who field
 * can — so several pickup raids at once read as one pickup cohort.
 */

export type GroupingMode = "auto" | "guild" | "lair";

/** Sentinel cohort keys kept out of the guild namespace (guild names can't start ' '). */
const PICKUP_KEY = " pickup";
const LAIR_KEY = " lair";

export interface RaidCohortSnapshot {
  /** Stable grouping key (the guild name, or an internal sentinel). */
  readonly key: string;
  /** Human label for messages, e.g. "<Nightfall>", "a pickup group", "the lair". */
  readonly label: string;
  /** Members in the cohort right now (0 when it has just left). */
  readonly count: number;
  /** The most members seen in this cohort while it was tracked. */
  readonly peak: number;
  /** Current roster by name — the array used to distinguish and follow a group. */
  readonly members: readonly string[];
}

export type RaidEvent =
  | { readonly kind: "raid-forming"; readonly cohort: RaidCohortSnapshot; readonly initial: boolean }
  | { readonly kind: "raid-left"; readonly cohort: RaidCohortSnapshot };

export interface ActiveRaid {
  readonly label: string;
  readonly count: number;
  readonly peak: number;
}

interface CohortState {
  active: boolean;
  peak: number;
  label: string;
  members: Map<string, WhoPlayer>;
}

export class RaidTracker {
  readonly #formAt: number;
  readonly #leaveAt: number;
  readonly #mode: GroupingMode;
  readonly #cohorts = new Map<string, CohortState>();
  #firstPoll = true;

  /**
   * `formAt` — members needed to declare a raid. `leaveAt` — the hysteresis floor:
   * an active raid clears (and re-arms) when it drops BELOW this, not only at zero,
   * so a raid that leaves a straggler or two behind still resets for the next one.
   */
  constructor(formAt: number, mode: GroupingMode = "auto", leaveAt = Math.max(1, Math.floor(formAt / 3))) {
    this.#formAt = formAt;
    this.#leaveAt = Math.min(leaveAt, formAt - 1 > 0 ? formAt - 1 : 1);
    this.#mode = mode;
  }

  /** Current roster names keyed by cohort — for logging and tests. */
  get rosters(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [key, state] of this.#cohorts) out.set(key, [...state.members.keys()]);
    return out;
  }

  /** Raids that have formed and not yet cleared — for a live status query. */
  activeRaids(): ActiveRaid[] {
    const out: ActiveRaid[] = [];
    for (const state of this.#cohorts.values()) {
      if (state.active) out.push({ label: state.label, count: state.members.size, peak: state.peak });
    }
    return out;
  }

  update(players: readonly WhoPlayer[]): RaidEvent[] {
    const initial = this.#firstPoll;
    this.#firstPoll = false;

    const cohorts = this.#assign(players);
    const events: RaidEvent[] = [];

    for (const key of new Set([...this.#cohorts.keys(), ...cohorts.keys()])) {
      const current = cohorts.get(key) ?? [];
      const existing = this.#cohorts.get(key);

      if (current.length === 0) {
        if (existing) {
          if (existing.active) events.push({ kind: "raid-left", cohort: snapshot(key, existing, []) });
          this.#cohorts.delete(key);
        }
        continue;
      }

      const state = existing ?? { active: false, peak: 0, label: "", members: new Map() };
      state.members = new Map(current.map((player) => [player.name, player]));
      state.label = this.#labelFor(key, current);
      if (current.length > state.peak) state.peak = current.length;
      this.#cohorts.set(key, state);

      if (state.active && current.length < this.#leaveAt) {
        // Dropped below the clear floor — the raid has left; re-arm for the next one.
        events.push({ kind: "raid-left", cohort: snapshot(key, state, current) });
        state.active = false;
        state.peak = current.length;
      } else if (!state.active && current.length >= this.#formAt) {
        state.active = true;
        events.push({ kind: "raid-forming", cohort: snapshot(key, state, current), initial });
      }
    }
    return events;
  }

  /** Partition this poll's players into cohorts per the grouping mode. */
  #assign(players: readonly WhoPlayer[]): Map<string, WhoPlayer[]> {
    if (this.#mode === "lair") {
      return players.length > 0 ? new Map([[LAIR_KEY, [...players]]]) : new Map();
    }

    const byGuild = new Map<string, WhoPlayer[]>();
    for (const player of players) {
      const key = player.guild.trim() || PICKUP_KEY;
      const bucket = byGuild.get(key);
      if (bucket) bucket.push(player);
      else byGuild.set(key, [player]);
    }

    if (this.#mode === "guild") return byGuild;

    // "auto": a guild at strength (or already an active raid) is its own cohort;
    // every other player pools into the pickup cohort.
    const cohorts = new Map<string, WhoPlayer[]>();
    const pickup: WhoPlayer[] = [];
    for (const [key, members] of byGuild) {
      const namedRaid =
        key !== PICKUP_KEY &&
        (members.length >= this.#formAt || (this.#cohorts.get(key)?.active ?? false));
      if (namedRaid) cohorts.set(key, members);
      else pickup.push(...members);
    }
    if (pickup.length > 0) cohorts.set(PICKUP_KEY, pickup);
    return cohorts;
  }

  #labelFor(key: string, members: readonly WhoPlayer[]): string {
    if (key === LAIR_KEY) {
      const guild = dominantGuild(members);
      return guild ? `the lair (mostly <${guild.guild}>)` : "the lair";
    }
    if (key === PICKUP_KEY) return "a pickup group";
    return `<${key}>`;
  }
}

function snapshot(key: string, state: CohortState, members: readonly WhoPlayer[]): RaidCohortSnapshot {
  return {
    key,
    label: state.label,
    count: members.length,
    peak: state.peak,
    members: members.map((player) => player.name),
  };
}

/** The guild most players belong to, and how many — for a readable summary. */
export function dominantGuild(
  players: readonly WhoPlayer[],
): { guild: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const player of players) {
    if (player.guild.length === 0) continue;
    counts.set(player.guild, (counts.get(player.guild) ?? 0) + 1);
  }
  let best: { guild: string; count: number } | null = null;
  for (const [guild, count] of counts) {
    if (best === null || count > best.count) best = { guild, count };
  }
  return best;
}
