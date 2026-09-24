import type { UnitPosition } from "../protocol/movement.js";
import type { WorldPlayer, WorldPoint } from "../protocol/update-object.js";
import type { Faction } from "./buff-store.js";
import { factionOfRace } from "./faction.js";

/**
 * The players around a listener: their class and side, whether alive when seen, and where they stand
 * — so a plea can ask one who could resurrect by name, and the listeners can tell who is in earshot.
 *
 * A player's race and class come with them into view; their position with that, and as they move.
 * Kept only while in view.
 */

/** The 1.12 classes that can resurrect a player, and the spell each would use. */
export const RESURRECTION_BY_CLASS: ReadonlyMap<number, string> = new Map([
  [2, "Redemption"], // paladin
  [5, "Resurrection"], // priest
  [7, "Ancestral Spirit"], // shaman
  [11, "Rebirth"], // druid — a battle rez, on a long cooldown and a reagent
]);

export interface NearbyPlayer {
  readonly guid: bigint;
  readonly classId: number;
  readonly distance: number;
}

interface Tracked {
  readonly faction: Faction | null;
  readonly classId: number;
  readonly alive: boolean;
  pos: WorldPoint | null;
}

export class NearbyPlayers {
  readonly #players = new Map<bigint, Tracked>();

  /** A player came into view. */
  seen(player: WorldPlayer): void {
    this.#players.set(player.guid, {
      faction: factionOfRace(player.raceId),
      classId: player.classId,
      alive: player.health > 0,
      pos: this.#players.get(player.guid)?.pos ?? null,
    });
  }

  /** A unit was placed or moved — kept when it is a player in view. */
  moved({ guid, pos }: UnitPosition): void {
    const player = this.#players.get(guid);
    if (player) player.pos = pos;
  }

  /** A unit left view. */
  gone(guid: bigint): void {
    this.#players.delete(guid);
  }

  /** Every player within `radiusYd` of `from`, nearest first. */
  around(from: WorldPoint, radiusYd: number): readonly NearbyPlayer[] {
    const near: NearbyPlayer[] = [];
    for (const [guid, player] of this.#players) {
      const distance = distanceTo(player, from);
      if (distance !== null && distance <= radiusYd) near.push({ guid, classId: player.classId, distance });
    }
    return near.sort((a, b) => a.distance - b.distance);
  }

  /** The nearest living player of `faction` — or of a race not mapped to a side yet, since asking an
   *  enemy is merely wasted — who can resurrect, within `radiusYd` of `from`, not in `exclude`. */
  nearestHealer(from: WorldPoint, radiusYd: number, faction: Faction, exclude: ReadonlySet<bigint>): NearbyPlayer | null {
    let best: NearbyPlayer | null = null;
    for (const [guid, player] of this.#players) {
      if (!RESURRECTION_BY_CLASS.has(player.classId) || !player.alive || exclude.has(guid)) continue;
      if (player.faction !== null && player.faction !== faction) continue;
      const distance = distanceTo(player, from);
      if (distance === null || distance > radiusYd || (best && best.distance <= distance)) continue;
      best = { guid, classId: player.classId, distance };
    }
    return best;
  }
}

function distanceTo(player: Tracked, from: WorldPoint): number | null {
  return player.pos === null ? null : Math.hypot(player.pos.x - from.x, player.pos.y - from.y, player.pos.z - from.z);
}
