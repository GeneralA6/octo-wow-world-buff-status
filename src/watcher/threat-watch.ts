import { unitRef } from "../protocol/guid.js";
import type { UnitPosition } from "../protocol/movement.js";
import type { UnitOwner } from "../protocol/unit-owner.js";
import type { WorldPoint } from "../protocol/update-object.js";

/** The creature a warlock's Inferno raises — the Infernal whose Immolation killed both Orgrimmar
 *  listeners. Its entry sits in its GUID, so it is known on sight with nothing to ask. */
export const INFERNAL_ENTRY = 89;

export type Threat =
  | {
      readonly kind: "infernal";
      readonly guid: bigint;
      /** Who raised or holds it, when its object update said. */
      readonly owner: UnitOwner | null;
      readonly distance: number;
    }
  | { readonly kind: "shunned-player"; readonly guid: bigint; readonly distance: number };

export interface ThreatWatchDeps {
  /** Whether a player is on the wall of shame, by GUID. */
  readonly isShunned: (guid: bigint) => boolean;
  /** Who a unit in view answers to. */
  readonly ownerOf: (guid: bigint) => UnitOwner | null;
  /** The first threat to come within reach — the only one reported; the answer to it is to leave. */
  readonly onThreat: (threat: Threat) => void;
}

export interface ThreatWatchOptions {
  /** How close a threat may come before the listener leaves. */
  readonly radiusYd: number;
}

/**
 * Watches the units around a parked listener for the two kinds that can kill it, while they are
 * still far enough off to log out: an Infernal, and a player on the wall of shame.
 *
 * Only within `radiusYd` — a capital is busy, and a threat across the square is not yet one. Both
 * kinds are remembered while in view, and judged again as they move and once our own position is
 * known, so one walking closer is caught when it crosses the line. A creature walks a whole path on
 * one packet, so its path is judged whole: one that sets off from across the square toward us, or
 * past us, is caught as it sets off rather than when it has already arrived.
 */
export class ThreatWatch {
  readonly #deps: ThreatWatchDeps;
  readonly #radiusYd: number;
  #self: WorldPoint | null = null;
  /** Where each unit that would be a threat up close was last seen, and where it was heading. */
  readonly #watched = new Map<bigint, UnitPosition>();
  #reported = false;

  constructor(deps: ThreatWatchDeps, options: ThreatWatchOptions) {
    this.#deps = deps;
    this.#radiusYd = options.radiusYd;
  }

  /** Where we stand. */
  self(pos: WorldPoint): void {
    this.#self = pos;
    for (const position of this.#watched.values()) this.#judge(position);
  }

  /** A unit came into view or moved. */
  moved(position: UnitPosition): void {
    if (!this.#isThreatening(position.guid)) return;
    this.#watched.set(position.guid, position);
    this.#judge(position);
  }

  /** A unit left view or was destroyed. */
  gone(guid: bigint): void {
    this.#watched.delete(guid);
  }

  #isThreatening(guid: bigint): boolean {
    const ref = unitRef(guid);
    if (ref.kind === "creature" || ref.kind === "pet") return ref.entry === INFERNAL_ENTRY;
    return ref.kind === "player" && this.#deps.isShunned(guid);
  }

  #judge({ guid, pos, destination }: UnitPosition): void {
    if (this.#reported || this.#self === null) return;
    const distance = destination ? distanceToPath(this.#self, pos, destination) : distanceBetween(this.#self, pos);
    if (distance > this.#radiusYd) return;
    this.#reported = true;
    this.#deps.onThreat(
      unitRef(guid).kind === "player"
        ? { kind: "shunned-player", guid, distance }
        : { kind: "infernal", guid, owner: this.#deps.ownerOf(guid), distance },
    );
  }
}

function distanceBetween(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** How near a straight walk from `from` to `to` comes to `point`. */
function distanceToPath(point: WorldPoint, from: WorldPoint, to: WorldPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (lengthSq === 0) return distanceBetween(point, from);
  const along = ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) / lengthSq;
  const t = Math.min(1, Math.max(0, along));
  return distanceBetween(point, { x: from.x + t * dx, y: from.y + t * dy, z: from.z + t * dz });
}
