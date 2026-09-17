/**
 * The Darkmoon Faire calendar — pure date math, no network and no world connection, so
 * `/darkmoon` answers even while the watcher is offline.
 *
 * Vanilla (1.12) runs the faire for one week a month, alternating between Elwynn Forest
 * (south of Goldshire) and Mulgore (below Thunder Bluff). That makes the WHEN fully
 * computable; the only fact the math cannot derive is the WHERE — which zone a given
 * month belongs to. That is pinned by a single `anchor`, and the anchor shipped here is
 * the vanilla assumption, NOT a confirmed Turtle observation (see `barker.ts`, which
 * learns the real parity from the server and corrects it).
 *
 * All day boundaries are realm-clock, expressed as a fixed `utcOffsetMinutes` — never the
 * host's local time, which would silently differ between a laptop and the Railway box.
 */

export type FaireLocation = "elwynn" | "mulgore";

export const FAIRE_LOCATIONS: readonly FaireLocation[] = ["elwynn", "mulgore"];

export function isFaireLocation(value: string): value is FaireLocation {
  return FAIRE_LOCATIONS.some((location) => location === value);
}

/** The other side of the alternation. */
export function otherLocation(location: FaireLocation): FaireLocation {
  return location === "elwynn" ? "mulgore" : "elwynn";
}

/** Reader-facing names for a site: the zone, and the landmark a player actually navigates to. */
export interface FaireSite {
  readonly zone: string;
  readonly landmark: string;
}

export const FAIRE_SITES: Record<FaireLocation, FaireSite> = {
  elwynn: { zone: "Elwynn Forest", landmark: "south of Goldshire" },
  mulgore: { zone: "Mulgore", landmark: "below Thunder Bluff" },
};

/** Pins the alternation: this month hosted at this location, every other month follows. */
export interface FaireAnchor {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly location: FaireLocation;
}

/** The rule the faire runs on. Configurable so a Turtle deviation is a config change, not a patch. */
export interface FaireSchedule {
  /** Day-of-week the faire opens, 0 = Sunday. Vanilla opens Monday. */
  readonly opensOnWeekday: number;
  /** Which occurrence of that weekday in the month; 1 = the first. */
  readonly occurrence: number;
  readonly durationDays: number;
  /** Realm clock as a fixed offset from UTC, in minutes. */
  readonly utcOffsetMinutes: number;
  readonly anchor: FaireAnchor;
}

export const VANILLA_SCHEDULE: FaireSchedule = {
  opensOnWeekday: 1,
  occurrence: 1,
  durationDays: 7,
  utcOffsetMinutes: 0,
  anchor: { year: 2026, month: 9, location: "elwynn" },
};

/** One month's faire: where, and the realm-clock half-open interval it is up for. */
export interface FaireWindow {
  readonly location: FaireLocation;
  readonly opensAt: number;
  /** Exclusive — the faire is up while `opensAt <= t < closesAt`. */
  readonly closesAt: number;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Months since year 0, so alternation is one subtraction instead of calendar branching. */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = monthIndex(year, month) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * Which side of the alternation a month falls on. Even distance from the anchor keeps the
 * anchor's location; odd flips it. Works in both directions (months before the anchor too).
 */
export function locationForMonth(schedule: FaireSchedule, year: number, month: number): FaireLocation {
  const distance = monthIndex(year, month) - monthIndex(schedule.anchor.year, schedule.anchor.month);
  const even = ((distance % 2) + 2) % 2 === 0;
  return even ? schedule.anchor.location : otherLocation(schedule.anchor.location);
}

/** Realm-clock midnight on a given calendar day, as an epoch ms. */
function realmMidnight(schedule: FaireSchedule, year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - schedule.utcOffsetMinutes * MINUTE_MS;
}

/** The day-of-month the faire opens on: the Nth `opensOnWeekday` of that month. */
function openingDayOfMonth(schedule: FaireSchedule, year: number, month: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offsetToFirst = (schedule.opensOnWeekday - firstWeekday + 7) % 7;
  return 1 + offsetToFirst + (schedule.occurrence - 1) * 7;
}

/** The faire window for a specific month, whether or not it is in the past. */
export function windowForMonth(schedule: FaireSchedule, year: number, month: number): FaireWindow {
  const opensAt = realmMidnight(schedule, year, month, openingDayOfMonth(schedule, year, month));
  return {
    location: locationForMonth(schedule, year, month),
    opensAt,
    closesAt: opensAt + schedule.durationDays * DAY_MS,
  };
}

/** The faire right now: either up (with the one after it), or between visits. */
export type FaireState =
  | { readonly phase: "up"; readonly current: FaireWindow; readonly next: FaireWindow }
  | { readonly phase: "travelling"; readonly next: FaireWindow };

/** Realm-clock year/month containing an instant. */
function realmMonthOf(schedule: FaireSchedule, at: number): { year: number; month: number } {
  const shifted = new Date(at + schedule.utcOffsetMinutes * MINUTE_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

export function faireStateAt(schedule: FaireSchedule, now: number): FaireState {
  const { year, month } = realmMonthOf(schedule, now);
  const thisMonth = windowForMonth(schedule, year, month);
  // Before this month's opening the previous month's faire is long closed (it ends inside the
  // first fortnight), so the only two cases are "this month's, not yet" and "this month's, now".
  if (now < thisMonth.opensAt) return { phase: "travelling", next: thisMonth };
  const after = addMonths(year, month, 1);
  const nextMonth = windowForMonth(schedule, after.year, after.month);
  if (now < thisMonth.closesAt) return { phase: "up", current: thisMonth, next: nextMonth };
  return { phase: "travelling", next: nextMonth };
}

/** The window a sighting "now" would be talking about: the one up, else the one coming. */
export function referenceWindow(state: FaireState): FaireWindow {
  return state.phase === "up" ? state.current : state.next;
}

/**
 * Parse a `YYYY-MM:location` anchor as configuration carries it, e.g. "2026-09:elwynn".
 * Null on anything malformed, so a typo falls back to the shipped anchor loudly rather than
 * silently moving the faire to the wrong zone for every month in both directions.
 */
export function parseFaireAnchor(raw: string): FaireAnchor | null {
  const match = /^(\d{4})-(\d{1,2}):([a-z]+)$/.exec(raw.trim().toLowerCase());
  if (match === null) return null;
  const [, yearRaw, monthRaw, location] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (month < 1 || month > 12) return null;
  if (!isFaireLocation(location)) return null;
  return { year, month, location };
}
