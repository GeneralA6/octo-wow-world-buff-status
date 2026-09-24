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
 * known, so one walking closer is caught when it crosses the line.
 */
export class ThreatWatch {
  readonly #deps: ThreatWatchDeps;
  readonly #radiusYd: number;
  #self: WorldPoint | null = null;
  /** Where each unit that would be a threat up close was last seen. */
  readonly #watched = new Map<bigint, WorldPoint>();
  #reported = false;

  constructor(deps: ThreatWatchDeps, options: ThreatWatchOptions) {
    this.#deps = deps;
    this.#radiusYd = options.radiusYd;
  }

  /** Where we stand. */
  self(pos: WorldPoint): void {
    this.#self = pos;
    for (const [guid, where] of this.#watched) this.#judge(guid, where);
  }

  /** A unit came into view or moved. */
  moved({ guid, pos }: UnitPosition): void {
    if (!this.#isThreatening(guid)) return;
    this.#watched.set(guid, pos);
    this.#judge(guid, pos);
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

  #judge(guid: bigint, pos: WorldPoint): void {
    if (this.#reported || this.#self === null) return;
    const distance = distanceBetween(this.#self, pos);
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
