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
  | {
      readonly kind: "raid-left";
      readonly cohort: RaidCohortSnapshot;
      /** How long the raid lasted (form → clear), when known — for duration learning. */
      readonly durationMs?: number;
    };

export interface ActiveRaid {
  readonly label: string;
  readonly count: number;
  readonly peak: number;
}

/**
 * A synthetic "raid-left" event for a clear confirmed by the ClearTracker, so the
 * park-now alert runs through the same buff-gate + dedup + announce path as a detector
 * event. The ClearTracker is lair-granular and boss-blind, so the label is generic — and
 * the cleared alert's wording uses only the peak and the cities anyway, never the label.
 */
export function clearedRaidEvent(peak: number): RaidEvent {
  return { kind: "raid-left", cohort: { key: LAIR_KEY, label: "a raid", count: 0, peak, members: [] } };
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
  // Which cohort each tracked player belongs to (auto mode), so an ACTIVE raid keeps its
  // members instead of shedding them to a newly-forming cohort. Rebuilt every poll from
  // who is present; a player of an active cohort is sticky, everyone else is regrouped.
  #assignmentByName = new Map<string, string>();
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

  /**
   * Absorb the current /who as a fresh baseline WITHOUT emitting any events — used
   * after a blind gap (long disconnect / server outage), so the raid that was active
   * before isn't reported as leaving and whatever is here now doesn't re-announce.
   */
  rebaseline(players: readonly WhoPlayer[]): void {
    this.#firstPoll = false;
    this.#cohorts.clear();
    for (const [key, members] of this.#assign(players)) {
      this.#cohorts.set(key, {
        active: members.length >= this.#formAt,
        peak: members.length,
        label: this.#labelFor(key, members),
        members: new Map(members.map((player) => [player.name, player])),
      });
    }
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
    if (this.#mode === "guild") {
      const byGuild = new Map<string, WhoPlayer[]>();
      for (const player of players) pushTo(byGuild, player.guild.trim() || PICKUP_KEY, player);
      return byGuild;
    }
    return this.#assignAuto(players);
  }

  /**
   * "auto" (sticky): a member of an ACTIVE cohort keeps it, so a raid never sheds members to
   * a newly-forming cohort — which is what made a guild crossing the strength line empty the
   * pickup it grew inside and fire a false "left". Newcomers join their guild's active cohort
   * if it has one, else pool with the other unassigned players; from that pool a guild bloc at
   * strength opens its OWN cohort and everyone else forms or joins pickup. A not-yet-formed
   * pickup is regrouped fresh each poll, so a guild reaching strength before any raid is active
   * is still named at formation.
   */
  #assignAuto(players: readonly WhoPlayer[]): Map<string, WhoPlayer[]> {
    const result = new Map<string, WhoPlayer[]>();
    const nextAssignment = new Map<string, string>();
    const place = (key: string, player: WhoPlayer): void => {
      pushTo(result, key, player);
      nextAssignment.set(player.name, key);
    };
    const isActive = (key: string): boolean => this.#cohorts.get(key)?.active ?? false;

    // 1. Members of an active cohort stay put.
    const unassigned: WhoPlayer[] = [];
    for (const player of players) {
      const prior = this.#assignmentByName.get(player.name);
      if (prior !== undefined && isActive(prior)) place(prior, player);
      else unassigned.push(player);
    }

    // 2. A newcomer whose guild already runs an active cohort joins it; the rest form a pool.
    const pool: WhoPlayer[] = [];
    for (const player of unassigned) {
      const guild = player.guild.trim();
      if (guild && isActive(guild)) place(guild, player);
      else pool.push(player);
    }

    // 3. In the pool, a guild bloc at strength opens its own cohort; everyone else pickups.
    const byGuild = new Map<string, WhoPlayer[]>();
    for (const player of pool) pushTo(byGuild, player.guild.trim() || PICKUP_KEY, player);
    for (const [key, members] of byGuild) {
      const ownCohort = key !== PICKUP_KEY && members.length >= this.#formAt;
      for (const player of members) place(ownCohort ? key : PICKUP_KEY, player);
    }

    this.#assignmentByName = nextAssignment;
    return result;
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

/** Append a value to the array under `key`, creating the array on first use. */
function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
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
