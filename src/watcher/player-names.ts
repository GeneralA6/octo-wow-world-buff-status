/**
 * Names a player's GUID through whichever of our characters is in world to ask.
 *
 * A listener that sees an Infernal logs straight out, so it is not connected long enough to ask who
 * raised it; it hands the owner's GUID to the rest, and one of them asks. A name query answers for
 * any GUID, near or far, so any character in world will do.
 */

/** A character's way of naming a GUID — a name query on its own connection; null when unanswered. */
export type NameResolver = (guid: bigint) => Promise<string | null>;

export interface ResolveOptions {
  /** A character not to ask — the one leaving. */
  readonly except?: string;
  /** How many rounds to try, when nobody can answer yet. */
  readonly attempts?: number;
  /** The wait between rounds. */
  readonly retryMs?: number;
}

export class PlayerNames {
  readonly #resolvers = new Map<string, NameResolver>();
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
    this.#sleep = sleep;
  }

  /** A character in world offers its name queries. */
  register(character: string, resolver: NameResolver): void {
    this.#resolvers.set(character, resolver);
  }

  /** The character left the world. */
  unregister(character: string): void {
    this.#resolvers.delete(character);
  }

  /**
   * The player's name, asked of each character in turn; a round in which nobody could say is tried
   * again after `retryMs`, up to `attempts` rounds. Null when no round found it.
   */
  async resolve(guid: bigint, options: ResolveOptions = {}): Promise<string | null> {
    const attempts = options.attempts ?? 1;
    for (let round = 0; round < attempts; round += 1) {
      if (round > 0) await this.#sleep(options.retryMs ?? 0);
      for (const [character, resolver] of [...this.#resolvers]) {
        if (character === options.except) continue;
        const name = await resolver(guid);
        if (name !== null) return name;
      }
    }
    return null;
  }
}
