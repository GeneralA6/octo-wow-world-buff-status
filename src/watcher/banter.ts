import { conversationsFor, type Conversation, type Part } from "./banter-lines.js";
import type { Faction } from "./buff-store.js";
import { COMEBACKS, SOLO_COMEBACKS } from "./comeback-lines.js";
import type { ListenerRoster, ShamedBystander, Speaker } from "./listener-roster.js";
import { SHAME_JOKES, shameJokesFor } from "./shame-jokes.js";

/**
 * Has the two listeners of one capital hold a conversation, one /say each in turn, a few seconds
 * apart. Only listeners of the same capital talk: Orgrimmar's pair with each other, and Stormwind's
 * with each other. A conversation is dropped, never resumed, once either speaker dies or leaves the
 * world — even if it is back by the next line.
 *
 * With a player from the wall of shame in earshot, half the conversations are a joke about them, by
 * name; the other half go on as usual, so the square doesn't hear nothing else while they stay. Each
 * capital goes through its other conversations, and jokes, before repeating a recent one.
 */

/** A conversation that was held. */
export interface Held {
  readonly faction: Faction;
  readonly between: readonly [string, string];
  readonly kind: Conversation["kind"];
  /** The player on the wall of shame it made fun of, or null. */
  readonly about: string | null;
  /** False when a speaker died or left the world before its end. */
  readonly finished: boolean;
}

export interface BanterOptions {
  /** Chooses among `count`. */
  readonly pick?: (count: number) => number;
  /** Waits `ms` between two lines. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Whether, with a shamed player in earshot, this conversation is a joke about them. Even odds. */
  readonly tellShameJoke?: () => boolean;
  /** The pause between one line of a conversation and the next, whatever their length. */
  readonly lineGapMs?: number;
}

/** The pause between two lines when none is given. */
export const DEFAULT_LINE_GAP_MS = 10_000;

/** How a listener brought back from the dead was welcomed. */
export interface WelcomedBack {
  readonly back: string;
  /** Its partner, who welcomed it — or null when there was none, and it joked on its own. */
  readonly partner: string | null;
  /** False when either died or left the world before the end. */
  readonly finished: boolean;
}

/** What to say, and about whom. */
interface Tale {
  readonly conversation: Conversation;
  readonly about: string | null;
}

export class Banter {
  readonly #roster: ListenerRoster;
  readonly #pick: (count: number) => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #tellShameJoke: () => boolean;
  readonly #lineGapMs: number;
  /** Per capital, the conversations it held lately, the newest last. */
  readonly #recent = new Map<Faction, number[]>();
  /** Per capital, the shame jokes it told lately, the newest last. */
  readonly #recentShame = new Map<Faction, number[]>();
  /** Per capital, the welcome-backs, and the lone quips, it had lately. */
  readonly #recentComebacks = new Map<Faction, number[]>();
  readonly #recentSoloComebacks = new Map<Faction, number[]>();
  readonly #talking = new Set<Faction>();

  constructor(roster: ListenerRoster, options: BanterOptions = {}) {
    this.#roster = roster;
    this.#pick = options.pick ?? ((count) => Math.floor(Math.random() * count));
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#tellShameJoke = options.tellShameJoke ?? (() => Math.random() < 0.5);
    this.#lineGapMs = options.lineGapMs ?? DEFAULT_LINE_GAP_MS;
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

    const tale = this.#tale(faction, [first, second]);
    if (!tale) return null;
    const cast: Record<Part, Speaker> = { a: first, b: second };

    this.#talking.add(faction);
    try {
      const finished = await this.#perform(faction, tale.conversation, cast);
      return { faction, between: [first.name, second.name], kind: tale.conversation.kind, about: tale.about, finished };
    } finally {
      this.#talking.delete(faction);
    }
  }

  /**
   * `character`, of `faction`'s capital, was just brought back from the dead: a moment after its
   * thanks to its healer, its partner welcomes it back and it answers — or, with no partner alive and
   * in world to hear it, it jokes on its own. Null when it is no longer alive and in world by then,
   * or the pair are talking already.
   */
  async welcomeBack(faction: Faction, character: string): Promise<WelcomedBack | null> {
    if (this.#talking.has(faction)) return null;
    this.#talking.add(faction);
    try {
      await this.#sleep(this.#lineGapMs); // let its thanks be heard first
      const speakers = this.#roster.speakers(faction);
      const back = speakers.find((speaker) => speaker.name === character);
      if (!back) return null;
      const partners = speakers.filter((speaker) => speaker !== back);
      const partner = partners[this.#index(partners.length)];
      if (!partner) {
        const index = this.#fresh(this.#recentSoloComebacks, faction, [...SOLO_COMEBACKS.keys()]);
        const line = index === undefined ? undefined : SOLO_COMEBACKS[index];
        if (line) back.voice.say(line);
        return { back: character, partner: null, finished: line !== undefined };
      }
      const index = this.#fresh(this.#recentComebacks, faction, [...COMEBACKS.keys()]);
      const comeback = index === undefined ? undefined : COMEBACKS[index];
      if (!comeback) return null;
      const finished = await this.#perform(faction, comeback, { a: partner, b: back });
      return { back: character, partner: partner.name, finished };
    } finally {
      this.#talking.delete(faction);
    }
  }

  /** A joke about a shamed player in earshot, half the time there is one — else a conversation. */
  #tale(faction: Faction, speakers: readonly Speaker[]): Tale | null {
    const shamed = inEarshot(speakers);
    const target = shamed.length > 0 ? shamed[this.#index(shamed.length)] : undefined;
    if (target && this.#tellShameJoke()) {
      const index = this.#fresh(this.#recentShame, faction, shameJokesFor(target.classId));
      const joke = index === undefined ? undefined : SHAME_JOKES[index];
      if (joke) return { conversation: { kind: "joke", lines: joke.lines(target.name) }, about: target.name };
    }
    const conversations = conversationsFor(faction);
    const index = this.#fresh(this.#recent, faction, [...conversations.keys()]);
    const conversation = index === undefined ? undefined : conversations[index];
    return conversation ? { conversation, about: null } : null;
  }

  async #perform(faction: Faction, conversation: Conversation, cast: Record<Part, Speaker>): Promise<boolean> {
    for (const [index, [part, line]] of conversation.lines.entries()) {
      if (index > 0) await this.#sleep(this.#lineGapMs);
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

  /** One of `candidates` that `faction`'s capital has not had from `memory` lately. */
  #fresh(memory: Map<Faction, number[]>, faction: Faction, candidates: readonly number[]): number | undefined {
    const recent = memory.get(faction) ?? [];
    const fresh = candidates.filter((candidate) => !recent.includes(candidate));
    const chosen = fresh[this.#index(fresh.length)] ?? candidates[this.#index(candidates.length)];
    if (chosen === undefined) return undefined;
    // Remember about half of them, so a capital goes through the rest before any comes round again.
    memory.set(faction, [...recent, chosen].slice(-Math.floor(candidates.length / 2)));
    return chosen;
  }

  #index(count: number): number {
    return Math.min(count - 1, Math.max(0, this.#pick(count)));
  }
}

/** The shamed players either speaker can hear — once each, though both may see them. */
function inEarshot(speakers: readonly Speaker[]): readonly ShamedBystander[] {
  const byName = new Map<string, ShamedBystander>();
  for (const speaker of speakers) {
    for (const bystander of speaker.voice.shamedNearby()) byName.set(bystander.name, bystander);
  }
  return [...byName.values()];
}
