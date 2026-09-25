/**
 * Whether the Spire is due a reading, on a lair poll's turn. The lair poll it rides on is jittered
 * (±`jitterRatio`), so a strict "a full interval since the last" skips every other poll whenever the
 * two intervals match — which read the Spire every ~1.5 minutes instead of every one. A poll that
 * comes within the jitter of the interval is taken.
 */
export function spireReadDue(lastReadAt: number | null, now: number, intervalMs: number, jitterRatio: number): boolean {
  return lastReadAt === null || now - lastReadAt >= intervalMs * (1 - jitterRatio);
}
