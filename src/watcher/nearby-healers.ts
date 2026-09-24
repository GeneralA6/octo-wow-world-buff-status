import type { UnitPosition } from "../protocol/movement.js";
import type { WorldPlayer, WorldPoint } from "../protocol/update-object.js";
import type { Faction } from "./buff-store.js";
import { factionOfRace } from "./faction.js";

/**
 * The players around a listener who could bring its dead partner back — so the plea can ask one of
 * them by name rather than the air.
 *
 * A player's race and class come with them into view; their position with that, and as they move.
 * Only the classes with a resurrection are kept, and only while in view. One of the listener's side
 * — or of a race not mapped to a side yet, since asking an enemy is merely wasted — and alive when
 * seen is a candidate.
 */

/** The 1.12 classes that can resurrect a player, and the spell each would use. */
export const RESURRECTION_BY_CLASS: ReadonlyMap<number, string> = new Map([
  [2, "Redemption"], // paladin
  [5, "Resurrection"], // priest
  [7, "Ancestral Spirit"], // shaman
  [11, "Rebirth"], // druid — a battle rez, on a long cooldown and a reagent
]);

export interface NearbyHealer {
  readonly guid: bigint;
  readonly classId: number;
  readonly distance: number;
}

interface Healer {
  readonly faction: Faction | null;
  readonly classId: number;
  readonly alive: boolean;
  pos: WorldPoint | null;
}

export class NearbyHealers {
  readonly #healers = new Map<bigint, Healer>();

  /** A player came into view. Kept only when their class can resurrect. */
  seen(player: WorldPlayer): void {
    if (!RESURRECTION_BY_CLASS.has(player.classId)) return;
    this.#healers.set(player.guid, {
      faction: factionOfRace(player.raceId),
      classId: player.classId,
      alive: player.health > 0,
      pos: this.#healers.get(player.guid)?.pos ?? null,
    });
  }

  /** A unit was placed or moved — kept when it is one of ours. */
  moved({ guid, pos }: UnitPosition): void {
    const healer = this.#healers.get(guid);
    if (healer) healer.pos = pos;
  }

  /** A unit left view. */
  gone(guid: bigint): void {
    this.#healers.delete(guid);
  }

  /** The nearest living healer of `faction` within `radiusYd` of `from`, not in `exclude`. */
  nearest(from: WorldPoint, radiusYd: number, faction: Faction, exclude: ReadonlySet<bigint>): NearbyHealer | null {
    let best: NearbyHealer | null = null;
    for (const [guid, healer] of this.#healers) {
      if (!healer.alive || healer.pos === null || exclude.has(guid)) continue;
      if (healer.faction !== null && healer.faction !== faction) continue;
      const distance = Math.hypot(healer.pos.x - from.x, healer.pos.y - from.y, healer.pos.z - from.z);
      if (distance > radiusYd || (best && best.distance <= distance)) continue;
      best = { guid, classId: healer.classId, distance };
    }
    return best;
  }
}
