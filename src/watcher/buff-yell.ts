import type { Faction } from "./buff-store.js";

/**
 * Recognises the city-wide NPC yell that fires when a dragon head is turned in and
 * the Rallying Cry of the Dragonslayer buff drops (a).
 *
 * EITHER Onyxia's or Nefarian's head triggers the same faction-wide buff, and a
 * hanging head of either blocks the next turn-in for the buff's duration — so all
 * four yells count equally as "this faction's buff just dropped". Missing the
 * Nefarian ones would let the gate believe a slot is open that a Nef raid took.
 *
 * Trigger strings are from the PizzaWorldBuffs addon (Turtle WoW) and MUST be
 * confirmed against a live Octo drop. The world client logs any unmatched monster
 * yell so the real text can be captured and corrected here if Octo's differs.
 */

interface YellTrigger {
  readonly faction: Faction;
  /** A distinctive substring of the full yell; matched with `includes`. */
  readonly needle: string;
}

const TRIGGERS: readonly YellTrigger[] = [
  { faction: "alliance", needle: "Onyxia, hangs from the arches" },
  { faction: "alliance", needle: "the Lord of Blackrock is slain! Nefarian has been subdued" },
  { faction: "horde", needle: "The brood mother, Onyxia, has been slain" },
  { faction: "horde", needle: "NEFARIAN IS SLAIN! People of Orgrimmar" },
];

/** The faction whose buff just dropped, or null if the text is not a buff yell. */
export function matchBuffYell(text: string): Faction | null {
  for (const trigger of TRIGGERS) {
    if (text.includes(trigger.needle)) return trigger.faction;
  }
  return null;
}
