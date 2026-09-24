import { conversationsFor, type Conversation, type Part } from "./banter-lines.js";
import type { Faction } from "./buff-store.js";
import type { ListenerRoster } from "./listener-roster.js";

/**
 * Has the two listeners of one capital hold a conversation, one /say each in turn, paced like two
 * players reading each other's line and typing their own. Only listeners of the same capital talk: Orgrimmar's pair with each other, and
 * Stormwind's with each other. A conversation stops as soon as either speaker dies or leaves the world,
 * and each capital goes through its other conversations before repeating a recent one.
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

/** A player's reading pace, about 25 characters a second, and a beat to take the line in. */
const READ_MS_PER_CHAR = 40;
const TAKE_IN_MS = 1_000;
/** A player's typing pace in chat, about 5 characters a second. */
const TYPE_MS_PER_CHAR = 200;
const SHORTEST_PAUSE_MS = 5_000;
const LONGEST_PAUSE_MS = 20_000;

/** How long before `line` is said after `previous`: its speaker reads the one, then types the other. */
export function pauseBefore(previous: string, line: string): number {
  const pause = TAKE_IN_MS + READ_MS_PER_CHAR * previous.length + TYPE_MS_PER_CHAR * line.length;
  return Math.min(LONGEST_PAUSE_MS, Math.max(SHORTEST_PAUSE_MS, pause));
}

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
    const cast: Record<Part, string> = { a: first.name, b: second.name };

    this.#talking.add(faction);
    try {
      const finished = await this.#perform(faction, conversation, cast);
      return { faction, between: [first.name, second.name], kind: conversation.kind, finished };
    } finally {
      this.#talking.delete(faction);
    }
  }

  async #perform(faction: Faction, conversation: Conversation, cast: Record<Part, string>): Promise<boolean> {
    let previous: string | null = null;
    for (const [part, line] of conversation.lines) {
      if (previous !== null) await this.#sleep(pauseBefore(previous, line));
      // Both must still be here: half a conversation, answered by no one, is worse than none.
      const present = this.#roster.speakers(faction);
      const speaker = present.find((candidate) => candidate.name === cast[part]);
      const listener = present.find((candidate) => candidate.name === cast[part === "a" ? "b" : "a"]);
      if (!speaker || !listener) return false;
      speaker.voice.say(line);
      previous = line;
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
