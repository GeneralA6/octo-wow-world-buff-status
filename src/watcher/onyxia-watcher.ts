import type { WhoPlayer } from "../protocol/who.js";

/**
 * Turns a stream of /who snapshots into occupancy transitions.
 *
 * Pure and synchronous: feed it each poll's players, get back the events that
 * poll implies. The caller decides which events to push and how to phrase them.
 *
 * Identity is the player name (unique per realm). Transitions:
 *   - empty -> occupied  => "raid-entered"   (a group appeared in the lair)
 *   - occupied -> empty  => "raid-left"       (the lair cleared)
 *   - occupied -> occupied with membership change => "roster-changed"
 *
 * The very first poll only establishes a baseline. If the lair already has
 * people then, it reports "raid-entered" with `initial: true` so a caller can
 * word it as "already in progress" rather than "a raid just pulled".
 */

export type WatchEvent =
  | { readonly kind: "raid-entered"; readonly players: readonly WhoPlayer[]; readonly initial: boolean }
  | { readonly kind: "raid-left"; readonly previousPlayers: readonly WhoPlayer[] }
  | {
      readonly kind: "roster-changed";
      readonly entered: readonly WhoPlayer[];
      readonly left: readonly string[];
      readonly players: readonly WhoPlayer[];
    };

export class OnyxiaWatcher {
  /** null until the first poll; then the last-seen players keyed by name. */
  #known: Map<string, WhoPlayer> | null = null;

  /** Names currently believed to be in the lair (empty before the first poll). */
  get currentNames(): readonly string[] {
    return this.#known ? [...this.#known.keys()] : [];
  }

  update(players: readonly WhoPlayer[]): WatchEvent[] {
    const current = new Map(players.map((player) => [player.name, player]));

    if (this.#known === null) {
      this.#known = current;
      return players.length > 0
        ? [{ kind: "raid-entered", players: [...current.values()], initial: true }]
        : [];
    }

    const previous = this.#known;
    this.#known = current;

    const entered = players.filter((player) => !previous.has(player.name));
    const left = [...previous.keys()].filter((name) => !current.has(name));

    const wasEmpty = previous.size === 0;
    const isEmpty = current.size === 0;

    if (wasEmpty && !isEmpty) {
      return [{ kind: "raid-entered", players: [...current.values()], initial: false }];
    }
    if (!wasEmpty && isEmpty) {
      return [{ kind: "raid-left", previousPlayers: [...previous.values()] }];
    }
    if (!isEmpty && (entered.length > 0 || left.length > 0)) {
      return [{ kind: "roster-changed", entered, left, players: [...current.values()] }];
    }
    return [];
  }
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
