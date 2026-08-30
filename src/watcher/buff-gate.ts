import type { BuffState } from "./buff-store.js";

/**
 * The notification gate (d): decide whether a raid is worth a "get ready to park" alert.
 *
 * A raid is only actionable if its head could produce a FRESH buff. That needs the
 * current buff to have expired — the head despawned — by the time the raid finishes.
 * While a buff is still up, the raid's head is banked and we stay quiet, so a buff
 * that just dropped opens a silent window until it expires.
 *
 * Pure and faction-agnostic: the caller passes the relevant faction's buff state and
 * when the raid is expected to finish (for an ending raid, roughly now plus travel to
 * the city; for a forming raid, its start plus the learned average clear time).
 */

export interface AlertDecision {
  readonly alert: boolean;
  readonly reason: string;
}

export function shouldAlertForRaid(
  buff: BuffState | null,
  predictedRaidEndMs: number,
  nowMs: number,
): AlertDecision {
  if (!buff) {
    return { alert: true, reason: "no buff on record — a fresh drop is possible" };
  }
  const expiresAtMs = buff.expiresAt.getTime();
  if (nowMs >= expiresAtMs) {
    return { alert: true, reason: "buff already expired — a fresh drop is possible" };
  }
  if (predictedRaidEndMs >= expiresAtMs) {
    return {
      alert: true,
      reason: "raid should finish after the buff expires — a fresh drop is possible",
    };
  }
  return {
    alert: false,
    reason: "buff still active and the raid finishes before it expires — head will be banked",
  };
}
