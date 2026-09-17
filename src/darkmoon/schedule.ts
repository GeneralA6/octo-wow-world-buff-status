/**
 * The Darkmoon Faire calendar — pure date math, no network and no world connection, so
 * `/darkmoon` answers even while the watcher is offline.
 *
 * The faire visits for one week a month, alternating between Elwynn Forest (south of Goldshire)
 * and Mulgore (below Thunder Bluff). The rule is NOT "the first Monday of the month", which is the
 * obvious guess and is wrong roughly two months in five:
 *
 *   the carnies begin SETTING UP on the first FRIDAY, and the faire OPENS the Monday after
 *
 * Those coincide only when the 1st falls Tue-Fri. When a month opens on a Saturday, Sunday or
 * Monday they are a whole week apart — Blizzard's own Classic schedule ran 10-16 February 2020
 * (a month starting Saturday, first Monday the 3rd) and 9-15 March 2020 (starting Sunday, first
 * Monday the 2nd). Both are the Monday after the first Friday; neither is the first Monday.
 *
 * The setup window earns its place in the model rather than being rounded away: the tents and all
 * the faire NPCs are physically in the zone for those three days, which is exactly when a player
 * can mouseover one and produce a sighting (see `pwb.ts`). Folding setup into "not the faire"
 * would make every such sighting look like proof the schedule is broken.
 *
 * What the math cannot derive is WHERE — which zone a given month belongs to. That hangs off a
 * single `anchor`, and while the shipped one is sourced rather than invented, it is Blizzard's
 * Classic rotation and not a confirmed Turtle observation. `resolve.ts` corrects it from the
 * server the first time the bot hears a herald or a sighting.
 *
 * All day boundaries are realm-clock, expressed as a fixed `utcOffsetMinutes` — never the host's
 * local time, which would silently differ between a laptop and the Railway box.
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
  /** Weekday the carnies start setting up, 0 = Sunday. Vanilla sets up on a Friday. */
  readonly setupWeekday: number;
  /** Which occurrence of that weekday in the month; 1 = the first. */
  readonly occurrence: number;
  /** Days from setup to the faire opening. Vanilla takes three (Friday to Monday). */
  readonly setupToOpenDays: number;
  /** How long the faire is open once it opens. */
  readonly durationDays: number;
  /** Realm clock as a fixed offset from UTC, in minutes. */
  readonly utcOffsetMinutes: number;
  readonly anchor: FaireAnchor;
}

/**
 * The vanilla rule, with the anchor taken from Blizzard's published WoW Classic schedule
 * ("February 10-February 16, Mulgore"), so the shipped alternation is sourced rather than guessed.
 * Turtle could still run a month out of phase with Classic — that is what the learning corrects.
 */
export const VANILLA_SCHEDULE: FaireSchedule = {
  setupWeekday: 5,
  occurrence: 1,
  setupToOpenDays: 3,
  durationDays: 7,
  utcOffsetMinutes: 0,
  anchor: { year: 2020, month: 2, location: "mulgore" },
};

/** One month's faire: where, and the realm-clock instants it sets up, opens and closes. */
export interface FaireWindow {
  readonly location: FaireLocation;
  /** Tents and NPCs appear — the faire is physically in the zone from here. */
  readonly setupAt: number;
  /** The faire opens for business. */
  readonly opensAt: number;
  /** Exclusive — the faire is open while `opensAt <= t < closesAt`. */
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

/** The day-of-month setup begins on: the Nth `setupWeekday` of that month. */
function setupDayOfMonth(schedule: FaireSchedule, year: number, month: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offsetToFirst = (schedule.setupWeekday - firstWeekday + 7) % 7;
  return 1 + offsetToFirst + (schedule.occurrence - 1) * 7;
}

/** The faire window for a specific month, whether or not it is in the past. */
export function windowForMonth(schedule: FaireSchedule, year: number, month: number): FaireWindow {
  const setupAt = realmMidnight(schedule, year, month, setupDayOfMonth(schedule, year, month));
  const opensAt = setupAt + schedule.setupToOpenDays * DAY_MS;
  return {
    location: locationForMonth(schedule, year, month),
    setupAt,
    opensAt,
    closesAt: opensAt + schedule.durationDays * DAY_MS,
  };
}

/**
 * The faire right now. "setting-up" and "up" both mean it is physically in the zone — the
 * difference is only whether a player can spend tickets yet.
 */
export type FaireState =
  | { readonly phase: "setting-up"; readonly current: FaireWindow; readonly next: FaireWindow }
  | { readonly phase: "up"; readonly current: FaireWindow; readonly next: FaireWindow }
  | { readonly phase: "travelling"; readonly next: FaireWindow };

/** Whether the faire's tents are physically in a zone in this state. */
export function isPresent(state: FaireState): state is Extract<FaireState, { current: FaireWindow }> {
  return state.phase !== "travelling";
}

/** Realm-clock year/month containing an instant. */
function realmMonthOf(schedule: FaireSchedule, at: number): { year: number; month: number } {
  const shifted = new Date(at + schedule.utcOffsetMinutes * MINUTE_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

export function faireStateAt(schedule: FaireSchedule, now: number): FaireState {
  const { year, month } = realmMonthOf(schedule, now);
  const thisMonth = windowForMonth(schedule, year, month);
  // Before this month's setup the previous month's faire is long closed — it sets up inside the
  // first week and closes inside the third, so no window ever reaches into the following month.
  if (now < thisMonth.setupAt) return { phase: "travelling", next: thisMonth };
  const after = addMonths(year, month, 1);
  const nextMonth = windowForMonth(schedule, after.year, after.month);
  if (now < thisMonth.opensAt) return { phase: "setting-up", current: thisMonth, next: nextMonth };
  if (now < thisMonth.closesAt) return { phase: "up", current: thisMonth, next: nextMonth };
  return { phase: "travelling", next: nextMonth };
}

/** The window a sighting "now" would be talking about: the one in the zone, else the one coming. */
export function referenceWindow(state: FaireState): FaireWindow {
  return isPresent(state) ? state.current : state.next;
}

/**
 * Parse a `YYYY-MM:location` anchor as configuration carries it, e.g. "2020-02:mulgore".
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

/** The faire window belonging to the calendar month that contains an instant. */
export function windowContaining(schedule: FaireSchedule, at: number): FaireWindow {
  const { year, month } = realmMonthOf(schedule, at);
  return windowForMonth(schedule, year, month);
}
