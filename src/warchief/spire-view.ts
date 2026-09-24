import type { WhoPlayer } from "../protocol/who.js";

/**
 * What the Warchief's Blessing forecast reads of Blackrock Spire: who is inside, from one `/who`.
 *
 * Rend Blackhand dies in Upper Blackrock Spire, and his head — turned in to Thrall in Orgrimmar —
 * is what drops the blessing. Lower and Upper Blackrock Spire share one zone, so a reading holds the
 * 5-man LBRS parties and the 10-man UBRS raids mixed together; telling them apart is the run
 * tracker's job, not the reading's.
 */

/** A player seen in the Spire: what `/who` says of them, less the zone (always the Spire here). */
export type SpirePlayer = Omit<WhoPlayer, "areaId">;

/** One reading of the Spire. A lair `LairView` is one too — its players just carry a zone as well. */
export interface SpireView {
  readonly present: readonly SpirePlayer[];
  /** False when the `/who` was truncated or a slice failed — absences on it prove nothing. */
  readonly complete: boolean;
  readonly at: number;
}

/** A player's `/who` fields, copied — so a stored reading never carries a zone or the caller's object. */
export function spirePlayer(player: SpirePlayer): SpirePlayer {
  return {
    name: player.name,
    guild: player.guild,
    level: player.level,
    classId: player.classId,
    raceId: player.raceId,
  };
}
