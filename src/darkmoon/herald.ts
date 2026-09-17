import type { FaireLocation } from "./schedule.js";

/**
 * Recognises the Darkmoon Faire heralds, who wander a capital the week before the faire arrives
 * and announce it. This is the strongest signal the bot can get, and the only unforgeable one:
 * a monster yell/say comes from the server itself, where a `PWB_DMF:` line on the LFT channel is
 * typed by a player and could say anything.
 *
 * The catch is that the announcement text does NOT name the zone — it is all "The Darkmoon Faire
 * is coming! There is fun for children of ALL ages! Come one, come all!". What identifies the
 * location is WHO is speaking, because each herald only appears for the faction whose zone is next:
 *
 *   Kruban Darkblade   wanders Orgrimmar  the week before the faire sets up in Mulgore
 *   Melnan Darkstone   wanders Ironforge  the week before the faire sets up in Elwynn Forest
 *
 * So a herald is matched on sender NAME, with the text required only to mention the faire — enough
 * that an unrelated line from an NPC who happens to share a name cannot be read as an announcement.
 *
 * Two limits are worth knowing, and neither is fixable here:
 *
 *   1. A herald announces the faire that is ON ITS WAY, so it identifies the NEXT window, never a
 *      live one. The caller anchors it accordingly.
 *   2. Melnan stands in IRONFORGE. The bot's listeners are parked in Stormwind and Orgrimmar, so
 *      in practice only Kruban is ever in earshot — the Elwynn half of this signal needs a
 *      listener parked in Ironforge to ever fire.
 *
 * Whether the heralds YELL or merely SAY is unconfirmed on this realm, so the wiring feeds both
 * (see world-client's monster chat) and logs everything unmatched, exactly as `buff-yell.ts` does.
 */

interface HeraldTrigger {
  /** The herald's exact NPC name, as it arrives in the monster-chat packet. */
  readonly name: string;
  /** The zone this herald's presence announces. */
  readonly location: FaireLocation;
  /** The capital they wander, for the log line. */
  readonly capital: string;
}

const HERALDS: readonly HeraldTrigger[] = [
  { name: "Kruban Darkblade", location: "mulgore", capital: "Orgrimmar" },
  { name: "Melnan Darkstone", location: "elwynn", capital: "Ironforge" },
];

/** A distinctive word the announcement always carries, guarding against an unrelated line. */
const ANNOUNCEMENT_NEEDLE = "darkmoon";

export interface HeraldAnnouncement {
  readonly location: FaireLocation;
  readonly herald: string;
  readonly capital: string;
}

/**
 * The zone a herald is announcing, or null if this is not a herald announcement.
 *
 * Matching is on the sender's name because the text carries no zone; the text only has to mention
 * the faire at all.
 */
export function matchHerald(senderName: string, text: string): HeraldAnnouncement | null {
  if (!text.toLowerCase().includes(ANNOUNCEMENT_NEEDLE)) return null;
  const herald = HERALDS.find((candidate) => candidate.name === senderName.trim());
  if (herald === undefined) return null;
  return { location: herald.location, herald: herald.name, capital: herald.capital };
}
