import { randomInt } from "node:crypto";
import { subscriberKey } from "./store.js";

/**
 * One-time codes for linking a character to a Discord account, held in memory with
 * a TTL. Used by both link flows:
 *   - Flow A ("discord"): create with no discordId; the id is learned when the user
 *     DMs the bot the code.
 *   - Flow B ("discord <id>"): create with the pasted discordId; confirmed when the
 *     user whispers the code back in-game.
 * Codes are lost on restart, so a mid-link user simply links again.
 */

export interface PendingLink {
  readonly code: string;
  readonly character: string; // canonical (lowercased) character name
  readonly discordId: string | null;
  readonly expiresAt: number;
}

// Unambiguous alphabet — no 0/O, 1/I — so a code is easy to read and type.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_TTL_MS = 15 * 60_000;

export interface PendingLinksOptions {
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly generate?: () => string;
}

export class PendingLinks {
  readonly #byCode = new Map<string, PendingLink>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #generate: () => string;

  constructor(options: PendingLinksOptions = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#generate = options.generate ?? (() => defaultCode());
  }

  /** Create a code for `character` (replacing any prior pending for them). */
  create(character: string, discordId: string | null = null): string {
    const key = subscriberKey(character);
    for (const [code, pending] of this.#byCode) {
      if (pending.character === key) this.#byCode.delete(code);
    }
    let code = this.#generate();
    while (this.#byCode.has(code)) code = this.#generate();
    this.#byCode.set(code, { code, character: key, discordId, expiresAt: this.#now() + this.#ttlMs });
    return code;
  }

  /** Look up a live pending by code (pruning expired), without consuming it. */
  resolve(code: string): PendingLink | null {
    this.#prune();
    return this.#byCode.get(code.trim().toUpperCase()) ?? null;
  }

  /** Consume a code once its link is done. */
  remove(code: string): void {
    this.#byCode.delete(code.trim().toUpperCase());
  }

  get size(): number {
    this.#prune();
    return this.#byCode.size;
  }

  #prune(): void {
    const now = this.#now();
    for (const [code, pending] of this.#byCode) {
      if (pending.expiresAt <= now) this.#byCode.delete(code);
    }
  }
}

function defaultCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
