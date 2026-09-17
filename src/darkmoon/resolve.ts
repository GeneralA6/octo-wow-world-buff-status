import {
  faireStateAt,
  FAIRE_SITES,
  otherLocation,
  referenceWindow,
  type FaireLocation,
  type FaireSchedule,
  type FaireSite,
} from "./schedule.js";

/**
 * Merges what the server told us (a PWB sighting) with what the calendar computes, into the one
 * answer `/darkmoon` gives.
 *
 * The two sources answer different questions and neither is redundant:
 *   - a sighting is ground truth for WHERE, but says nothing about when the faire opens or closes
 *     (PWB has no schedule logic at all — it only ever knows "last seen in X, N ago");
 *   - the calendar is exact about WHEN, but its zone alternation hangs off an anchor that was
 *     assumed, not observed.
 *
 * So a sighting does two jobs. While it is fresh it IS the answer; and forever after, it pins the
 * calendar's alternation — knowing one real month fixes every other month in both directions, and
 * unlike liveness that fact never goes stale. One player mouseovering one faire NPC permanently
 * corrects an anchor we shipped as a guess.
 */

export interface FaireSighting {
  readonly location: FaireLocation;
  /** Epoch ms the faire was SEEN — not when we heard about it. */
  readonly sightedAt: number;
  /** The player who saw it. Forgeable, so it is for logs only, never for a decision. */
  readonly witness: string;
}

/**
 * How recently the faire must have been seen for the sighting to mean "it is up right now".
 *
 * The faire is up for a week in a zone thick with players, and every PWB client rebroadcasts what
 * it knows every 10-60s, so during a live week the newest sighting is minutes old around the
 * clock. Once it packs up no new sighting is ever made, and the age of the last one only grows —
 * so this doubles as the "it has left" detector, at the cost of being up to this long stale on the
 * closing day. Half a day is short enough to correct quickly and long enough to survive a quiet
 * low-pop night mid-week.
 */
export const LIVE_SIGHTING_MS = 12 * 3_600_000;

export type FaireSource = "sighting" | "calendar";

export interface FaireReport {
  readonly phase: "up" | "travelling";
  readonly location: FaireLocation;
  readonly site: FaireSite;
  /** The calendar window, or null when a live sighting contradicts the calendar's week — we know
   *  WHERE the faire is because someone is standing in it, but not when it opened or closes. */
  readonly opensAt: number | null;
  readonly closesAt: number | null;
  /** Where the answer came from: seen on the server, or computed. */
  readonly source: FaireSource;
  /** Whether a real sighting has ever pinned the zone alternation. False = the shipped anchor is
   *  still an assumption and the reader is told so. */
  readonly locationConfirmed: boolean;
  /** The sighting behind the answer, for the log line. Null when the calendar answered alone. */
  readonly sighting: FaireSighting | null;
}

/**
 * Whether the calendar's alternation is upside down, judged against a sighting.
 *
 * Null = no conclusion: either we have never seen the faire, or the calendar says it was not even
 * up when it was seen. The second case means the WEEK rule is wrong, not just the zone, and no
 * amount of flipping fixes that — it needs a human to look at the schedule config.
 */
export function parityFlip(schedule: FaireSchedule, sighting: FaireSighting | null): boolean | null {
  if (sighting === null) return null;
  const state = faireStateAt(schedule, sighting.sightedAt);
  if (state.phase !== "up") return null;
  return state.current.location !== sighting.location;
}

/** The calendar's location for a window, corrected by whatever a sighting has taught us. */
function correct(location: FaireLocation, flip: boolean | null): FaireLocation {
  return flip === true ? otherLocation(location) : location;
}

export function resolveFaire(
  schedule: FaireSchedule,
  sighting: FaireSighting | null,
  now: number,
): FaireReport {
  const state = faireStateAt(schedule, now);
  const flip = parityFlip(schedule, sighting);
  const confirmed = flip !== null;

  // A sighting fresh enough to mean "someone is looking at it" outranks the calendar outright,
  // including on the question of whether the faire is up at all — a computed week cannot argue
  // with a player standing in the tents. A sighting dated in the future is clock skew or a
  // forgery, never evidence about now, so it falls through to the calendar path below.
  const age = sighting === null ? null : now - sighting.sightedAt;
  if (sighting !== null && age !== null && age >= 0 && age <= LIVE_SIGHTING_MS) {
    const window = state.phase === "up" ? state.current : null;
    return {
      phase: "up",
      location: sighting.location,
      site: FAIRE_SITES[sighting.location],
      opensAt: window?.opensAt ?? null,
      closesAt: window?.closesAt ?? null,
      source: "sighting",
      locationConfirmed: confirmed,
      sighting,
    };
  }

  const window = referenceWindow(state);
  const location = correct(window.location, flip);
  return {
    phase: state.phase,
    location,
    site: FAIRE_SITES[location],
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    source: "calendar",
    locationConfirmed: confirmed,
    sighting,
  };
}

/**
 * Whether a sighting lands outside every week the calendar knows about.
 *
 * This is the one failure the bot cannot heal on its own. A sighting in the wrong ZONE proves the
 * alternation is upside down and flips it permanently; a sighting on a day the rule calls quiet
 * proves the RULE is wrong — Turtle runs the faire on a different cadence than vanilla — and no
 * flip fixes that. It needs the DARKMOON_* schedule config changed, so it is worth a loud log
 * rather than a silent fallback.
 */
export function contradictsSchedule(schedule: FaireSchedule, sighting: FaireSighting): boolean {
  return faireStateAt(schedule, sighting.sightedAt).phase !== "up";
}
