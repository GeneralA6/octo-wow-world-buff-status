import type { Faction } from "./buff-store.js";

/**
 * While a listener lies dead, its partner in the same capital asks the passers-by — out loud, in
 * character — for someone to resurrect it. Both stand by the head, so the plea is heard right where
 * the body is, and the listener that dead one would otherwise wait on a person to log in for.
 *
 * Only a partner that is alive and in world can plead, and only for a listener of its own city; the
 * pleas stop the moment the dead one is alive again. Plain ASCII, one short /say, never how long it
 * has been.
 */

type Line = (partner: string) => string;

const LINES: readonly Line[] = [
  (partner) => `Could a kind soul resurrect my partner ${partner}? They fell right here, guarding the head.`,
  (partner) => `Any priests, shamans or paladins about? ${partner} could use a resurrection. Conjured water for your trouble!`,
  (partner) => `${partner} is lying here looking rather dead. Would anyone spare a resurrection?`,
  (partner) => `My partner ${partner} fell in the line of duty. Bring them back and I'll owe you a Portal.`,
];

/** A random plea for `partner`. `pick` chooses among `count`. */
export function pleaFor(
  partner: string,
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): string {
  const line = LINES[Math.min(LINES.length - 1, Math.max(0, pick(LINES.length)))] ?? LINES[0];
  return line ? line(partner) : "";
}

/** One plea made: who asked, for whom, and what they said. */
export interface Plea {
  readonly by: string;
  readonly for: string;
  readonly line: string;
}

interface Listener {
  readonly faction: Faction | null;
  alive: boolean;
}

export class PartnerPleas {
  readonly #listeners = new Map<string, Listener>();
  /** How each listener in world speaks. */
  readonly #voices = new Map<string, (line: string) => void>();
  readonly #pick: (count: number) => number;

  constructor(pick: (count: number) => number = (count) => Math.floor(Math.random() * count)) {
    this.#pick = pick;
  }

  /** A listener was found alive or dead. `faction` is the capital it stands in. */
  life(character: string, faction: Faction | null, alive: boolean): void {
    this.#listeners.set(character, { faction, alive });
  }

  /** A listener came into world and can speak — or, with null, left it. */
  voice(character: string, say: ((line: string) => void) | null): void {
    if (say) this.#voices.set(character, say);
    else this.#voices.delete(character);
  }

  /** Have a living partner ask for each dead listener to be resurrected. What was said, for the log. */
  plead(): readonly Plea[] {
    const pleas: Plea[] = [];
    for (const [dead, listener] of this.#listeners) {
      if (listener.alive || listener.faction === null) continue;
      const partner = this.#partnerOf(dead, listener.faction);
      if (!partner) continue;
      const line = pleaFor(dead, this.#pick);
      partner.say(line);
      pleas.push({ by: partner.name, for: dead, line });
    }
    return pleas;
  }

  #partnerOf(dead: string, faction: Faction): { name: string; say: (line: string) => void } | null {
    for (const [name, listener] of this.#listeners) {
      if (name === dead || !listener.alive || listener.faction !== faction) continue;
      const say = this.#voices.get(name);
      if (say) return { name, say };
    }
    return null;
  }
}
