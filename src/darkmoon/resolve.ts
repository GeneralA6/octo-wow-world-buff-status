import {
  faireStateAt,
  FAIRE_SITES,
  isPresent,
  otherLocation,
  referenceWindow,
  windowContaining,
  type FaireLocation,
  type FaireSchedule,
  type FaireSite,
} from "./schedule.js";

/**
 * Merges everything the bot has been told about the faire into the one answer `/darkmoon` gives.
 *
 * Four sources, in descending order of what they can be trusted to prove:
 *
 *   onsite    the bot's own character is standing next to the faire's staff. First-party and
 *             unforgeable, and it is about the faire that is HERE, NOW — the strongest thing
 *             available. Only covers the zone the character is parked in.
 *   herald    an NPC announcement heard in a capital. Also server-authored and unforgeable, but it
 *             describes the faire that is ON ITS WAY, never a live one.
 *   sighting  a PizzaWorldBuffs broadcast: some player mouseovered a faire NPC. Covers both zones
 *             and is usually current, but it is text a player typed, so it has to be corroborated.
 *   calendar  computed. Exact about when, and about where only as far as its anchor is right.
 *
 * They are not one ranking, because they answer different questions. For WHERE the alternation
 * sits, anything the server said outranks anything a player typed. For whether the faire is
 * physically in a zone this minute, seeing it ourselves beats hearing about it, which beats a
 * computed week — a calendar cannot argue with a character standing in the tents.
 *
 * Every observation is anchored to a specific faire WINDOW, identified by that window's setup
 * instant. That is what makes the correction permanent and direction-free: knowing one real
 * window's zone fixes every other month, forwards and backwards, forever — unlike liveness, which
 * goes stale within the day.
 */

export type ObservationSource = "onsite" | "herald" | "sighting";

export interface FaireObservation {
  readonly location: FaireLocation;
  /** The `setupAt` of the window this observation identifies — how it pins to the calendar. */
  readonly windowSetupAt: number;
  /** When the faire was seen, or the herald heard. */
  readonly observedAt: number;
  readonly source: ObservationSource;
  /** The NPC seen, the herald's name, or the PWB witness. Forgeable only for a sighting. */
  readonly witness: string;
}

/** Everything currently known. Any part may be absent. */
export interface FaireKnowledge {
  /** The faire seen by our own character, from where it is parked. */
  readonly onsite: FaireObservation | null;
  /** The newest herald announcement heard in a capital. */
  readonly herald: FaireObservation | null;
  /** The newest corroborated sighting off the LFT channel. */
  readonly sighting: FaireObservation | null;
}

export const NO_KNOWLEDGE: FaireKnowledge = { onsite: null, herald: null, sighting: null };

/**
 * How recently the faire must have been seen for the observation to mean "the tents are there now".
 *
 * The faire is in the zone for ten days including setup, in a zone thick with players, and every
 * PWB client rebroadcasts what it knows every 10-60s, so while it is there the newest sighting is
 * minutes old around the clock. Once it packs up no new one is ever made and the age of the last
 * only grows — so this doubles as the "it has left" detector, at the cost of being up to this long
 * stale on the closing day. Half a day is short enough to correct quickly and long enough to
 * survive a quiet low-pop night mid-week, or a parked character's reconnect.
 */
export const LIVE_SIGHTING_MS = 12 * 3_600_000;

/**
 * Anchor an observation of the faire being physically present to the window whose tents were seen.
 *
 * Null when the calendar says the faire was nowhere at that moment. That is the one failure the
 * bot cannot heal: seeing the wrong ZONE proves the alternation is upside down and flips it
 * permanently, but seeing the faire when the rule says it is away proves the RULE is wrong, and no
 * flip fixes that. The caller logs it for a human.
 */
function anchorPresent(
  schedule: FaireSchedule,
  location: FaireLocation,
  seenAt: number,
  witness: string,
  source: "onsite" | "sighting",
): FaireObservation | null {
  const state = faireStateAt(schedule, seenAt);
  if (!isPresent(state)) return null;
  return { location, windowSetupAt: state.current.setupAt, observedAt: seenAt, source, witness };
}

/** Anchor a PWB sighting to the window whose tents the witness was standing in. */
export function anchorSighting(
  schedule: FaireSchedule,
  location: FaireLocation,
  sightedAt: number,
  witness: string,
): FaireObservation | null {
  return anchorPresent(schedule, location, sightedAt, witness, "sighting");
}

/** Anchor our own character's sighting of a faire NPC standing next to it. */
export function anchorOnsite(
  schedule: FaireSchedule,
  location: FaireLocation,
  seenAt: number,
  npc: string,
): FaireObservation | null {
  return anchorPresent(schedule, location, seenAt, npc, "onsite");
}

/**
 * Anchor a herald to the window they are announcing — always the NEXT one, since a herald only
 * turns up to say the faire is coming. Unlike a present-faire observation this can never fail to
 * anchor: whatever the calendar thinks is happening now, there is always a next window.
 */
export function anchorHerald(
  schedule: FaireSchedule,
  location: FaireLocation,
  heardAt: number,
  herald: string,
): FaireObservation {
  return {
    location,
    windowSetupAt: faireStateAt(schedule, heardAt).next.setupAt,
    observedAt: heardAt,
    source: "herald",
    witness: herald,
  };
}

/** True when the faire was seen at a moment the calendar says it was nowhere. */
export function contradictsSchedule(schedule: FaireSchedule, seenAt: number): boolean {
  return !isPresent(faireStateAt(schedule, seenAt));
}

/** The observation that owns the alternation: whatever the SERVER said, before anything typed. */
function bestForParity(knowledge: FaireKnowledge): FaireObservation | null {
  return knowledge.onsite ?? knowledge.herald ?? knowledge.sighting;
}

/**
 * Whether the calendar's alternation is upside down, judged against the best observation held.
 * Null = nothing has ever pinned it, so the shipped anchor is still an assumption.
 *
 * Parity never changes, so two observations can only disagree if one is wrong — and the one a
 * player can type is the one that can be wrong on purpose.
 */
export function parityFlip(schedule: FaireSchedule, knowledge: FaireKnowledge): boolean | null {
  const best = bestForParity(knowledge);
  if (best === null) return null;
  return windowContaining(schedule, best.windowSetupAt).location !== best.location;
}

/** The calendar's location for a window, corrected by whatever an observation has taught us. */
function correct(location: FaireLocation, flip: boolean | null): FaireLocation {
  return flip === true ? otherLocation(location) : location;
}

export interface FaireReport {
  /** "setting-up" means the tents are there but it does not open for business yet. */
  readonly phase: "setting-up" | "up" | "travelling";
  readonly location: FaireLocation;
  readonly site: FaireSite;
  /** The calendar window, or null when a live observation contradicts the calendar's week — we
   *  know WHERE the faire is because something is standing in it, but not when it opened. */
  readonly setupAt: number | null;
  readonly opensAt: number | null;
  readonly closesAt: number | null;
  /** Where this answer's location came from. */
  readonly source: "onsite" | "sighting" | "calendar";
  /** What pinned the alternation, or null if nothing ever has and the zone is still an assumption. */
  readonly confirmedBy: ObservationSource | null;
  /** The observation behind a live answer, for the log line and the "last seen" wording. */
  readonly observation: FaireObservation | null;
}

export function resolveFaire(
  schedule: FaireSchedule,
  knowledge: FaireKnowledge,
  now: number,
): FaireReport {
  const state = faireStateAt(schedule, now);
  const flip = parityFlip(schedule, knowledge);
  const confirmedBy = flip === null ? null : (bestForParity(knowledge)?.source ?? null);

  // Seeing it ourselves beats hearing about it. Either outranks the calendar on whether the faire
  // is in the zone at all. An observation dated in the future is clock skew or a forgery, never
  // evidence about now, so it falls through to the calendar path below.
  const live = [knowledge.onsite, knowledge.sighting].find((observation) => {
    if (observation === null) return false;
    const age = now - observation.observedAt;
    return age >= 0 && age <= LIVE_SIGHTING_MS;
  });

  if (live !== undefined && live !== null) {
    // The calendar still owns the clock: when it agrees the faire is there, it can say whether the
    // tents are open for business yet, which an observation on its own cannot.
    const window = isPresent(state) ? state.current : null;
    return {
      phase: window === null ? "up" : state.phase,
      location: live.location,
      site: FAIRE_SITES[live.location],
      setupAt: window?.setupAt ?? null,
      opensAt: window?.opensAt ?? null,
      closesAt: window?.closesAt ?? null,
      source: live.source === "onsite" ? "onsite" : "sighting",
      confirmedBy,
      observation: live,
    };
  }

  const window = referenceWindow(state);
  const location = correct(window.location, flip);
  return {
    phase: state.phase,
    location,
    site: FAIRE_SITES[location],
    setupAt: window.setupAt,
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    source: "calendar",
    confirmedBy,
    observation: null,
  };
}
