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
 * Three sources, in descending order of what they can be trusted to prove:
 *
 *   herald    an NPC announcement heard in a capital. Server-authored, so unforgeable, and the
 *             herald only appears for the faction whose zone is next — but it describes the faire
 *             that is ON ITS WAY, never a live one.
 *   sighting  a PizzaWorldBuffs broadcast: a player mouseovered a faire NPC. Ground truth for
 *             where the tents are RIGHT NOW, but typed by a player and therefore forgeable.
 *   calendar  computed. Exact about when, and about where only as far as its anchor is right.
 *
 * They are not ranked on one axis, because they answer different questions. A herald outranks a
 * sighting on WHERE the alternation sits, since nobody can fake one; a sighting outranks a herald
 * (and the calendar) on whether the faire is physically in a zone right now, since the herald has
 * nothing to say about that and a computed week cannot argue with a player standing in the tents.
 *
 * Every observation is anchored to a specific faire WINDOW, identified by that window's setup
 * instant. That is what makes the parity correction permanent and direction-free: knowing one real
 * window's zone fixes every other month, forwards and backwards, forever — unlike liveness, which
 * goes stale within the day.
 */

export type ObservationSource = "herald" | "sighting";

export interface FaireObservation {
  readonly location: FaireLocation;
  /** The `setupAt` of the window this observation identifies — how it pins to the calendar. */
  readonly windowSetupAt: number;
  /** When the faire was seen, or the herald heard. */
  readonly observedAt: number;
  readonly source: ObservationSource;
  /** The herald's name, or the PWB witness. Forgeable for a sighting, so it is for logs only. */
  readonly witness: string;
}

/** Everything currently known. Either half may be absent; both may disagree with the calendar. */
export interface FaireKnowledge {
  /** The newest herald announcement heard. */
  readonly herald: FaireObservation | null;
  /** The newest faire sighting off the LFT channel. */
  readonly sighting: FaireObservation | null;
}

export const NO_KNOWLEDGE: FaireKnowledge = { herald: null, sighting: null };

/**
 * How recently the faire must have been seen for the sighting to mean "the tents are there now".
 *
 * The faire is in the zone for ten days including setup, in a zone thick with players, and every
 * PWB client rebroadcasts what it knows every 10-60s, so while it is there the newest sighting is
 * minutes old around the clock. Once it packs up no new sighting is ever made and the age of the
 * last one only grows — so this doubles as the "it has left" detector, at the cost of being up to
 * this long stale on the closing day. Half a day is short enough to correct quickly and long
 * enough to survive a quiet low-pop night mid-week.
 */
export const LIVE_SIGHTING_MS = 12 * 3_600_000;

/**
 * Anchor a PWB sighting to the window whose tents the witness was standing in.
 *
 * Null when the calendar says the faire was nowhere at that moment. That is the one failure the
 * bot cannot heal: a sighting in the wrong ZONE proves the alternation is upside down and flips it
 * permanently, but a sighting when the rule says the faire is away proves the RULE is wrong, and
 * no flip fixes that. The caller logs it for a human.
 */
export function anchorSighting(
  schedule: FaireSchedule,
  location: FaireLocation,
  sightedAt: number,
  witness: string,
): FaireObservation | null {
  const state = faireStateAt(schedule, sightedAt);
  if (!isPresent(state)) return null;
  return {
    location,
    windowSetupAt: state.current.setupAt,
    observedAt: sightedAt,
    source: "sighting",
    witness,
  };
}

/**
 * Anchor a herald to the window they are announcing — always the NEXT one, since a herald only
 * turns up to say the faire is coming. Unlike a sighting this can never fail to anchor: whatever
 * the calendar thinks is happening now, there is always a next window for them to be talking about.
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
export function contradictsSchedule(schedule: FaireSchedule, sightedAt: number): boolean {
  return !isPresent(faireStateAt(schedule, sightedAt));
}

/**
 * Whether the calendar's alternation is upside down, judged against the best observation held.
 * Null = nothing has ever pinned it, so the shipped anchor is still an assumption.
 *
 * The herald wins when both have an opinion. Parity never changes, so the two can only disagree
 * if one is wrong — and the one a player can type is the one that can be wrong on purpose.
 */
export function parityFlip(schedule: FaireSchedule, knowledge: FaireKnowledge): boolean | null {
  const best = knowledge.herald ?? knowledge.sighting;
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
  /** The calendar window, or null when a live sighting contradicts the calendar's week — we know
   *  WHERE the faire is because someone is standing in it, but not when it opened or closes. */
  readonly setupAt: number | null;
  readonly opensAt: number | null;
  readonly closesAt: number | null;
  /** Where this answer's location came from. */
  readonly source: "sighting" | "calendar";
  /** What pinned the alternation, or null if nothing ever has and the zone is still an assumption. */
  readonly confirmedBy: ObservationSource | null;
  /** The sighting behind a live answer, for the log line and the "last seen" wording. */
  readonly sighting: FaireObservation | null;
}

export function resolveFaire(
  schedule: FaireSchedule,
  knowledge: FaireKnowledge,
  now: number,
): FaireReport {
  const state = faireStateAt(schedule, now);
  const flip = parityFlip(schedule, knowledge);
  const confirmedBy = flip === null ? null : (knowledge.herald ?? knowledge.sighting)?.source ?? null;
  const { sighting } = knowledge;

  // A sighting fresh enough to mean someone is looking at the tents outranks the calendar on
  // whether the faire is in the zone at all. A sighting dated in the future is clock skew or a
  // forgery, never evidence about now, so it falls through to the calendar path below.
  const age = sighting === null ? null : now - sighting.observedAt;
  if (sighting !== null && age !== null && age >= 0 && age <= LIVE_SIGHTING_MS) {
    // The calendar still owns the clock: when it agrees the faire is there, it can say whether the
    // tents are open for business yet, which a sighting cannot.
    const window = isPresent(state) ? state.current : null;
    return {
      phase: window === null ? "up" : state.phase,
      location: sighting.location,
      site: FAIRE_SITES[sighting.location],
      setupAt: window?.setupAt ?? null,
      opensAt: window?.opensAt ?? null,
      closesAt: window?.closesAt ?? null,
      source: "sighting",
      confirmedBy,
      sighting,
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
    sighting,
  };
}
