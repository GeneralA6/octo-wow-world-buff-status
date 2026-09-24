import type { Faction } from "./buff-store.js";

/**
 * Which listeners are alive, in which capital, and how each in world speaks — the one record the
 * things listeners say to the city share: a partner's plea for a rez, their conversations.
 */

/** A player nearby who could resurrect, by name, and the spell they would use. */
export interface NamedHealer {
  readonly guid: bigint;
  readonly name: string;
  /** Resurrection, Redemption, Ancestral Spirit, Rebirth. */
  readonly spell: string;
}

/** How a listener in world takes part: its voice, and the healers it can see. */
export interface ListenerVoice {
  say(line: string): void;
  /** The nearest player who could resurrect, other than those in `exclude` — or null for none. */
  healerNearby(exclude: ReadonlySet<bigint>): Promise<NamedHealer | null>;
}

/** A listener that can speak right now. */
export interface Speaker {
  readonly name: string;
  readonly voice: ListenerVoice;
  /** Which stretch of being alive and in world this is: it changes whenever the listener dies, is
   *  brought back, leaves the world or comes back into it — however quickly one follows the other. */
  readonly stint: number;
}

interface Listener {
  readonly faction: Faction | null;
  readonly alive: boolean;
}

export class ListenerRoster {
  readonly #listeners = new Map<string, Listener>();
  readonly #voices = new Map<string, ListenerVoice>();
  readonly #stints = new Map<string, number>();

  /** A listener was found alive or dead. `faction` is the capital it stands in. */
  life(character: string, faction: Faction | null, alive: boolean): void {
    const before = this.#listeners.get(character);
    this.#listeners.set(character, { faction, alive });
    if (before?.alive !== alive) this.#nextStint(character);
  }

  /** A listener came into world and can speak — or, with null, left it. */
  voice(character: string, voice: ListenerVoice | null): void {
    if (voice) this.#voices.set(character, voice);
    else this.#voices.delete(character);
    this.#nextStint(character);
  }

  /** The listeners lying dead, and the capital each stands in. */
  dead(): readonly { readonly name: string; readonly faction: Faction | null }[] {
    return [...this.#listeners].filter(([, listener]) => !listener.alive).map(([name, { faction }]) => ({ name, faction }));
  }

  /** Whether a listener is alive. */
  isAlive(character: string): boolean {
    return this.#listeners.get(character)?.alive === true;
  }

  /** The living listeners of `faction` in world to speak, but for `except`. */
  speakers(faction: Faction, except?: string): readonly Speaker[] {
    const speakers: Speaker[] = [];
    for (const [name, listener] of this.#listeners) {
      if (name === except || !listener.alive || listener.faction !== faction) continue;
      const voice = this.#voices.get(name);
      if (voice) speakers.push({ name, voice, stint: this.#stints.get(name) ?? 0 });
    }
    return speakers;
  }

  #nextStint(character: string): void {
    this.#stints.set(character, (this.#stints.get(character) ?? 0) + 1);
  }
}
