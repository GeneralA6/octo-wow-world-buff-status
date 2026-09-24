/**
 * Recognises Thrall's yell in Orgrimmar when Rend Blackhand's head is turned in and the Warchief's
 * Blessing drops on the Horde there. A Horde-only buff: there is no Alliance counterpart.
 *
 * Thrall yells twice — the first announces Rend's fall, the second lands the buff — and either
 * counts; a second listener in the city, or the second yell, is folded into the same drop by the
 * caller's dedup window.
 *
 * The text is vanilla's and MUST be confirmed against a live drop on OctoWoW: every monster yell a
 * listener hears is logged, so if Octo's words differ they will be there to copy in.
 */

const NEEDLES: readonly string[] = [
  "The false Warchief, Rend Blackhand, has fallen",
  "Be bathed in my power! Drink in my might!",
];

/** Whether a monster yell is Thrall's Warchief's Blessing yell. */
export function isWarchiefBlessingYell(text: string): boolean {
  return NEEDLES.some((needle) => text.includes(needle));
}
