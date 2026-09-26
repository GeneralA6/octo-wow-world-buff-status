import { describeError } from "../errors.js";

/**
 * What becomes of the server's word that something one of our characters said never reached a player.
 *
 * "<name> is ignoring you": the player has that character on their ignore list — they plainly want
 * none of our pings, so they come off the subscriber list. The notice comes back for anything their
 * client refused, a whisper or just a /say or /yell in their earshot, so it can repeat on every line
 * nearby: each player is dealt with once a day, the rest of the echoes let be.
 *
 * "No player named <name>": a whisper to someone not online. Only logged — offline is no reason to
 * drop a subscription — and once a day per player too, as a broadcast whispers many at once.
 */

export interface WhisperRefusalsDeps {
  /** Take a player off the subscriber list; whether they were on it. */
  readonly unsubscribe: (name: string) => Promise<boolean>;
  readonly log: (line: string) => void;
  readonly now: () => number;
}

export interface WhisperRefusalsOptions {
  /** How long after dealing with a player their next notice is let be. */
  readonly quietMs: number;
}

export class WhisperRefusals {
  readonly #deps: WhisperRefusalsDeps;
  readonly #quietMs: number;
  readonly #ignoredAt = new Map<string, number>();
  readonly #notFoundAt = new Map<string, number>();

  constructor(deps: WhisperRefusalsDeps, options: WhisperRefusalsOptions) {
    this.#deps = deps;
    this.#quietMs = options.quietMs;
  }

  /** `player` is ignoring our `character`: unsubscribe them. */
  async ignoredBy(character: string, player: string): Promise<void> {
    if (!this.#fresh(this.#ignoredAt, player)) return;
    let unsubscribed: boolean;
    try {
      unsubscribed = await this.#deps.unsubscribe(player);
    } catch (error) {
      this.#deps.log(`whispers: ${player} is ignoring ${character}, but could not be unsubscribed (${describeError(error)})`);
      return;
    }
    this.#deps.log(
      `whispers: ${player} is ignoring ${character} — ` + (unsubscribed ? "unsubscribed" : "was not subscribed"),
    );
  }

  /** A whisper from our `character` to `player` found no such player online. */
  notFound(character: string, player: string): void {
    if (!this.#fresh(this.#notFoundAt, player)) return;
    this.#deps.log(`whispers: ${character} could not reach ${player} — not online`);
  }

  /** Whether `player` is due to be dealt with again, marking them dealt with now if so. */
  #fresh(seen: Map<string, number>, player: string): boolean {
    const key = player.toLowerCase();
    const now = this.#deps.now();
    const last = seen.get(key);
    if (last !== undefined && now - last < this.#quietMs) return false;
    seen.set(key, now);
    return true;
  }
}
