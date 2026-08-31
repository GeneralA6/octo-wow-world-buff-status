/**
 * Personal-invite linking: the bot mints a unique, single-use Discord invite per WoW
 * character and whispers the player their own link. When someone joins the server, we
 * diff the guild's invite use-counts against a cache to learn WHICH invite they used,
 * map that back to the character, and link their Discord id — automatically, and
 * verified (only that character was ever whispered that link).
 *
 * This module holds the two pure pieces: `whichInviteUsed` (the diff) and `InviteLinks`
 * (the code→character map). The gateway/REST wiring lives elsewhere and drives these.
 */

export interface InviteUse {
  readonly code: string;
  readonly uses: number;
}

/**
 * Given the use-counts we cached before a join and the guild's invites right after,
 * return the ONE invite code that was just consumed — or null when it can't be told
 * apart (nothing changed, or two invites changed at once, e.g. simultaneous joins).
 *
 * A single-use invite is auto-deleted by Discord the moment it's used, so an invite
 * that was in `before` and is missing from `after` counts as used, same as one whose
 * `uses` went up.
 */
export function whichInviteUsed(
  before: ReadonlyMap<string, number>,
  after: readonly InviteUse[],
): string | null {
  const candidates = new Set<string>();
  const afterCodes = new Set<string>();
  for (const { code, uses } of after) {
    afterCodes.add(code);
    if (uses > (before.get(code) ?? 0)) candidates.add(code);
  }
  for (const code of before.keys()) {
    if (!afterCodes.has(code)) candidates.add(code); // vanished => consumed (single-use)
  }
  return candidates.size === 1 ? [...candidates][0]! : null;
}

/** Build the cache the diff reads: code → uses, from a list of invites. */
export function useCounts(invites: readonly InviteUse[]): Map<string, number> {
  return new Map(invites.map((invite) => [invite.code, invite.uses]));
}

/**
 * In-memory map of an outstanding personal invite code to the character it was minted
 * for. One character has at most one live code — minting a new one drops the old.
 */
export class InviteLinks {
  readonly #byCode = new Map<string, string>(); // code -> character
  readonly #byCharacter = new Map<string, string>(); // character -> code

  set(code: string, character: string): void {
    const previous = this.#byCharacter.get(character);
    if (previous) this.#byCode.delete(previous);
    this.#byCode.set(code, character);
    this.#byCharacter.set(character, code);
  }

  /** Resolve and consume the character for a used invite code (one-shot). */
  take(code: string): string | null {
    const character = this.#byCode.get(code);
    if (character === undefined) return null;
    this.#byCode.delete(code);
    this.#byCharacter.delete(character);
    return character;
  }

  codeFor(character: string): string | null {
    return this.#byCharacter.get(character) ?? null;
  }

  get size(): number {
    return this.#byCode.size;
  }
}
