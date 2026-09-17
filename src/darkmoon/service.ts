import {
  CORROBORATION_WINDOW_MS,
  DEFAULT_CORROBORATION,
  shouldSettle,
  SightingTally,
  type CorroborationPolicy,
  type SettledSighting,
} from "./corroboration.js";
import { matchHerald } from "./herald.js";
import { isFaireNpc } from "./npcs.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import { isTrustedBroadcast, parseDmfBroadcast, sightedAt } from "./pwb.js";
import {
  anchorHerald,
  anchorOnsite,
  anchorSighting,
  contradictsSchedule,
  NO_KNOWLEDGE,
  resolveFaire,
  type FaireKnowledge,
  type FaireObservation,
  type FaireReport,
} from "./resolve.js";
import type { FaireLocation, FaireSchedule } from "./schedule.js";

/** How often standing in the faire is worth re-recording. The staff re-enters visibility all day;
 *  the observation only needs to stay fresh enough to read as live, not to log every refresh. */
const ONSITE_REFRESH_MS = 30 * 60_000;

/**
 * Holds what the bot knows about the Darkmoon Faire, fed by three things: what our own parked
 * character can see standing next to it, and the two it overhears —
 * NPC chat in the capitals (a herald announcing the faire is coming) and the LFT channel (a
 * PizzaWorldBuffs sighting). Kept in memory for the answer path and in Mongo so a redeploy does
 * not forget it.
 *
 * The two are stored side by side rather than as one "latest observation", because they are not
 * interchangeable: a herald is server-authored and cannot be faked, so it must never be displaced
 * by a `PWB_DMF:` line a player typed.
 *
 * Within the channel feed, newest-wins is PWB's own rule and keeping it means the bot and the
 * addon every player runs never disagree — but PWB is a client trusting its own user, and this is
 * a bot answering strangers, so newest-wins alone would let one troll move the answer and rewrite
 * the alternation for months. A sighting therefore has to clear `corroboration.ts` before it
 * counts, and only the herald path skips that, because the server is the one speaking.
 */

/** What a line on the LFT channel did. Reported rather than reduced to a boolean so the caller can
 *  tell "nothing to do with us" from "we cannot identify senders any more", which look identical
 *  from outside and mean very different things. */
export type ObserveOutcome =
  /** Became the settled sighting. */
  | "accepted"
  /** A valid claim, counted towards consensus, not (yet) enough to settle. */
  | "counted"
  /** Not a faire broadcast, or from a client version whose sightings cannot be trusted. */
  | "ignored"
  /** A faire broadcast with no usable sender — it cannot vote, and a silent feed would follow. */
  | "unidentified";

export interface FaireServiceDeps {
  readonly schedule: FaireSchedule;
  readonly store: KnowledgeStore;
  /** Fired when an observation is accepted, so the caller can log it. */
  readonly onObservation?: (observation: FaireObservation) => void;
  /** How much agreement a sighting needs before it is believed. Defaults to DEFAULT_CORROBORATION. */
  readonly corroboration?: CorroborationPolicy;
  /** Fired when the faire is seen at a moment the schedule says it is away — the rule is wrong
   *  and only a human can fix it. Carries the instant it was seen. */
  readonly onScheduleConflict?: (sightedAt: number) => void;
}

export class FaireService {
  readonly #deps: FaireServiceDeps;
  #knowledge: FaireKnowledge = NO_KNOWLEDGE;
  /** Live corroboration window over the LFT feed — deliberately not persisted. */
  readonly #tally = new SightingTally(CORROBORATION_WINDOW_MS);
  /** The zone currently settled on, for the change cooldown. */
  #settled: SettledSighting | null = null;

  constructor(deps: FaireServiceDeps) {
    this.#deps = deps;
  }

  /** Load the persisted observations. Call once on boot, before the first answer. */
  async load(): Promise<void> {
    this.#knowledge = await this.#deps.store.load();
  }

  /** What is currently held, for logging and tests. */
  get knowledge(): FaireKnowledge {
    return this.#knowledge;
  }

  /**
   * Offer a line heard on the LFT channel, with the SERVER-STAMPED id of whoever sent it.
   *
   * A line on its own is never believed — see `corroboration.ts`. It is a vote, and only a
   * corroborated majority is allowed to settle. `senderId` must be the sender from the packet,
   * never anything out of the message body, or the guard is worthless.
   */
  async observeChannel(text: string, senderId: string, receivedAt: number): Promise<ObserveOutcome> {
    const broadcast = parseDmfBroadcast(text);
    if (broadcast === null || !isTrustedBroadcast(broadcast)) return "ignored";

    // An unidentifiable sender cannot vote — counting it would hand a troll unlimited ballots.
    // Reported rather than swallowed: if the channel's sender field ever stops parsing, this is
    // the only thing that would make the whole feed go quiet, and silence should be visible.
    if (senderId === "" || senderId === "0") return "unidentified";

    this.#tally.record({ location: broadcast.location, senderId, at: receivedAt });
    const consensus = this.#tally.leader(receivedAt);
    // This line may only be believed if the majority is saying what IT says. Checking the
    // consensus alone would let a troll's line ride in on the quorum the honest clients built:
    // the gate would pass on their zone and then write his.
    if (consensus === null || consensus.location !== broadcast.location) return "counted";
    if (!shouldSettle(this.#deps.corroboration ?? DEFAULT_CORROBORATION, this.#settled, consensus, receivedAt)) {
      return "counted";
    }

    const seenAt = sightedAt(broadcast, receivedAt);
    const current = this.#knowledge.sighting;
    if (current !== null && seenAt <= current.observedAt) return "counted";

    const observation = anchorSighting(this.#deps.schedule, broadcast.location, seenAt, broadcast.witness);
    if (observation === null) {
      // The faire was seen when the calendar says it is nowhere. Nothing can be anchored to a
      // window the schedule does not believe exists, so this teaches us only that the rule needs
      // a human. Only reported once corroborated, so one troll line cannot raise the alarm.
      if (contradictsSchedule(this.#deps.schedule, seenAt)) this.#deps.onScheduleConflict?.(seenAt);
      return "counted";
    }
    this.#settled = { location: observation.location, acceptedAt: receivedAt };
    await this.#accept({ ...this.#knowledge, sighting: observation }, observation);
    return "accepted";
  }

  /**
   * Offer the name of an NPC standing next to our own parked character.
   *
   * This is the strongest signal the bot can get and it needs no corroboration: it is our own
   * client's object stream, not something a player typed. `location` is where the character is
   * parked — configuration, not a guess, because a unit update says what is nearby and never which
   * zone we are in. Returns true when it became the on-site observation.
   */
  async observeNearbyNpc(
    npc: string,
    location: FaireLocation,
    seenAt: number,
  ): Promise<boolean> {
    if (!isFaireNpc(npc)) return false;

    const observation = anchorOnsite(this.#deps.schedule, location, seenAt, npc);
    if (observation === null) {
      // We are looking straight at the faire on a day the rule says it is away. Coming from our
      // own client this is as close to proof as the bot gets that the schedule config is wrong.
      if (contradictsSchedule(this.#deps.schedule, seenAt)) this.#deps.onScheduleConflict?.(seenAt);
      return false;
    }
    const current = this.#knowledge.onsite;
    // The faire's staff is re-seen every time the character's visibility refreshes; only a new
    // window, or a fresher look at the one we are already in, is worth a write.
    if (current !== null && observation.windowSetupAt === current.windowSetupAt) {
      if (seenAt - current.observedAt < ONSITE_REFRESH_MS) return false;
    }
    return this.#accept({ ...this.#knowledge, onsite: observation }, observation);
  }

  /**
   * Offer an NPC chat line heard in a capital. Returns true when it was a herald announcement we
   * had not already heard for this window.
   */
  async observeMonsterChat(senderName: string, text: string, heardAt: number): Promise<boolean> {
    const announcement = matchHerald(senderName, text);
    if (announcement === null) return false;

    const observation = anchorHerald(
      this.#deps.schedule,
      announcement.location,
      heardAt,
      announcement.herald,
    );
    const current = this.#knowledge.herald;
    // Heralds repeat themselves every few minutes for a week; only a NEW window is news.
    if (current !== null && observation.windowSetupAt <= current.windowSetupAt) return false;
    return this.#accept({ ...this.#knowledge, herald: observation }, observation);
  }

  /** What to tell a player asking where the faire is. */
  report(now: number): FaireReport {
    return resolveFaire(this.#deps.schedule, this.#knowledge, now);
  }

  async #accept(knowledge: FaireKnowledge, accepted: FaireObservation): Promise<boolean> {
    this.#knowledge = knowledge;
    await this.#deps.store.save(knowledge);
    this.#deps.onObservation?.(accepted);
    return true;
  }
}
