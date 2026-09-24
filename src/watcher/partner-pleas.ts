import type { ListenerRoster, NamedHealer } from "./listener-roster.js";

/**
 * While a listener lies dead, its partner in the same capital asks the passers-by — out loud, in
 * character — for someone to resurrect it. Both stand by the head, so the plea is heard right where
 * the body is, and the listener that dead one would otherwise wait on a person to log in for.
 *
 * Only a partner that is alive and in world can plead, and only for a listener of its own city; the
 * pleas stop the moment the dead one is alive again. When a player who could resurrect stands near —
 * a priest, shaman, paladin or druid — the partner asks them by name and spell, each once a death. Plain ASCII, short and specific — a mage's
 * joke, not a form letter — and never how long it has been.
 */

type Line = (partner: string) => string;

const LINES: readonly Line[] = [
  (partner) => `Rez for ${partner}? Paying in conjured water.`,
  (partner) => `${partner} forgot to Ice Block. Healer, please!`,
  (partner) => `${partner} is too dead to Blink. Rez, anyone?`,
  (partner) => `Mage down! ${partner} needs a rez.`,
  (partner) => `${partner} got Inferno'd. Any healer with a heart?`,
  (partner) => `${partner} is face down by the head again. Rez?`,
  (partner) => `Spare a rez for ${partner}? Bread and water on me.`,
  (partner) => `${partner} tanked an Infernal. Poorly. Rez please?`,
  (partner) => `Priests, shamans, paladins - ${partner} needs you!`,
  (partner) => `${partner} is hugging the floor. Help a mage up?`,
  (partner) => `A rez for ${partner}? The Spirit Healer is dull company.`,
  (partner) => `${partner} Evocated way too hard. Anyone got a rez?`,
  (partner) => `Free conjured snacks for whoever rezzes ${partner}!`,
  (partner) => `${partner} died on duty. Rez the hero?`,
];

/** How many plea lines there are. */
export const PLEA_COUNT = LINES.length;

/** A random plea for `partner`. `pick` chooses among `count`. */
export function pleaFor(
  partner: string,
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): string {
  const line = LINES[Math.min(LINES.length - 1, Math.max(0, pick(LINES.length)))] ?? LINES[0];
  return line ? line(partner) : "";
}

type HealerLine = (healer: string, spell: string, partner: string) => string;

const HEALER_LINES: readonly HealerLine[] = [
  (healer, spell, partner) => `${healer}, could you cast ${spell} on ${partner}? Water's on me.`,
  (healer, spell, partner) => `${healer}! ${partner} could really use your ${spell}.`,
  (healer, spell, partner) => `Hey ${healer}, spare a rez for ${partner}? ${spell} would do nicely.`,
  (healer, spell, partner) => `${healer}, you're our only hope. ${spell} on ${partner}, please?`,
];

/** How many lines there are for asking a healer by name. */
export const HEALER_PLEA_COUNT = HEALER_LINES.length;

/** A random plea asking `healer` by name to resurrect `partner`. `pick` chooses among `count`. */
export function healerPleaFor(
  healer: Pick<NamedHealer, "name" | "spell">,
  partner: string,
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count),
): string {
  const line = HEALER_LINES[Math.min(HEALER_LINES.length - 1, Math.max(0, pick(HEALER_LINES.length)))] ?? HEALER_LINES[0];
  return line ? line(healer.name, healer.spell, partner) : "";
}

/** One plea made: who asked, for whom, which healer if one was asked by name, and what was said. */
export interface Plea {
  readonly by: string;
  readonly for: string;
  readonly healer: string | null;
  readonly line: string;
}

export class PartnerPleas {
  readonly #roster: ListenerRoster;
  /** The healers already asked for each dead listener — each is asked once a death, never nagged. */
  readonly #asked = new Map<string, Set<bigint>>();
  readonly #pick: (count: number) => number;

  constructor(roster: ListenerRoster, pick: (count: number) => number = (count) => Math.floor(Math.random() * count)) {
    this.#roster = roster;
    this.#pick = pick;
  }

  /**
   * Have a living partner ask for each dead listener to be resurrected — by name, of the nearest
   * healer not yet asked, or of anyone when none is about. What was said, for the log.
   */
  async plead(): Promise<readonly Plea[]> {
    // A listener back on its feet starts its next death with every healer unasked.
    for (const name of [...this.#asked.keys()]) if (this.#roster.isAlive(name)) this.#asked.delete(name);
    const pleas: Plea[] = [];
    for (const { name: dead, faction } of this.#roster.dead()) {
      if (faction === null) continue;
      const partner = this.#roster.speakers(faction, dead)[0];
      if (!partner) continue;
      const asked = this.#asked.get(dead) ?? new Set<bigint>();
      const healer = await partner.voice.healerNearby(asked).catch(() => null);
      if (healer) {
        asked.add(healer.guid);
        this.#asked.set(dead, asked);
      }
      const line = healer ? healerPleaFor(healer, dead, this.#pick) : pleaFor(dead, this.#pick);
      partner.voice.say(line);
      pleas.push({ by: partner.name, for: dead, healer: healer?.name ?? null, line });
    }
    return pleas;
  }
}
