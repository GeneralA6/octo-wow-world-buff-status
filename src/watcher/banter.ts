import { conversationsFor, type Conversation, type Part } from "./banter-lines.js";
import type { Faction } from "./buff-store.js";
import type { ListenerRoster, Speaker } from "./listener-roster.js";

/**
 * Has the two listeners of one capital hold a conversation, one /say each in turn, a few seconds
 * apart. Only listeners of the same capital talk: Orgrimmar's pair with each other, and Stormwind's
 * with each other. A conversation is dropped, never resumed, once either speaker dies or leaves the
 * world — even if it is back by the next line — and each capital goes through its other
 * conversations before repeating a recent one.
 */

/** A conversation that was held. */
export interface Held {
  readonly faction: Faction;
  readonly between: readonly [string, string];
  readonly kind: Conversation["kind"];
  /** False when a speaker died or left the world before its end. */
  readonly finished: boolean;
}

export interface BanterOptions {
  /** Chooses among `count`. */
  readonly pick?: (count: number) => number;
  /** Waits `ms` between two lines. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The pause between one line of a conversation and the next, whatever their length. */
export const LINE_GAP_MS = 10_000;

export class Banter {
  readonly #roster: ListenerRoster;
  readonly #pick: (count: number) => number;
  readonly #sleep: (ms: number) => Promise<void>;
  /** Per capital, the conversations it held lately, the newest last. */
  readonly #recent = new Map<Faction, number[]>();
  readonly #talking = new Set<Faction>();

  constructor(roster: ListenerRoster, options: BanterOptions = {}) {
    this.#roster = roster;
    this.#pick = options.pick ?? ((count) => Math.floor(Math.random() * count));
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Has two listeners of `faction`'s capital talk — or null when it hasn't two alive and in world,
   *  or they are talking already. */
  async converse(faction: Faction): Promise<Held | null> {
    if (this.#talking.has(faction)) return null;
    const speakers = this.#roster.speakers(faction);
    const first = speakers[this.#index(speakers.length)];
    const others = speakers.filter((speaker) => speaker !== first);
    const second = others[this.#index(others.length)];
    if (!first || !second) return null;

    const conversations = conversationsFor(faction);
    const conversation = conversations[this.#choose(faction, conversations.length)];
    if (!conversation) return null;
    const cast: Record<Part, Speaker> = { a: first, b: second };

    this.#talking.add(faction);
    try {
      const finished = await this.#perform(faction, conversation, cast);
      return { faction, between: [first.name, second.name], kind: conversation.kind, finished };
    } finally {
      this.#talking.delete(faction);
    }
  }

  async #perform(faction: Faction, conversation: Conversation, cast: Record<Part, Speaker>): Promise<boolean> {
    for (const [index, [part, line]] of conversation.lines.entries()) {
      if (index > 0) await this.#sleep(LINE_GAP_MS);
      // Both must still be here, and never have gone: one that died, logged out or dropped since the
      // last line — even if already back — ends it. Half a conversation, picked up again as if nothing
      // happened, is worse than none.
      const present = this.#roster.speakers(faction);
      const stayed = (speaker: Speaker): boolean =>
        present.some((candidate) => candidate.name === speaker.name && candidate.stint === speaker.stint);
      if (!stayed(cast.a) || !stayed(cast.b)) return false;
      cast[part].voice.say(line);
    }
    return true;
  }

  /** A conversation `faction`'s capital has not held lately. */
  #choose(faction: Faction, count: number): number {
    const recent = this.#recent.get(faction) ?? [];
    const fresh = Array.from({ length: count }, (_, index) => index).filter((index) => !recent.includes(index));
    const chosen = fresh[this.#index(fresh.length)] ?? 0;
    // Remember about half of them, so a capital goes through the rest before any comes round again.
    this.#recent.set(faction, [...recent, chosen].slice(-Math.floor(count / 2)));
    return chosen;
  }

  #index(count: number): number {
    return Math.min(count - 1, Math.max(0, this.#pick(count)));
  }
}
