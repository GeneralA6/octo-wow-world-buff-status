import { humanSpan } from "../notify/format.js";
import type { FaireAnswer } from "./observation.js";

/**
 * The whisper `/darkmoon` answers with. One line, like every other whisper the bot sends.
 *
 * The wording never predicts. It reports a look and how old it is, because that is all the bot
 * actually has — and on a realm where the faire moves weekly, "it is in Elwynn" and "it was in
 * Elwynn two days ago" are very different claims to the player deciding whether to fly there.
 */
export function formatFaire(answer: FaireAnswer, now: number): string {
  if (!answer.known) {
    return `I don't know where the Darkmoon Faire is right now - nobody's spotted it lately.`;
  }
  const where = `${answer.site.zone} (${answer.site.landmark})`;
  const ago = humanSpan(now - answer.observedAt);
  return answer.fresh
    ? `Darkmoon Faire is in ${where} - seen ${ago} ago.`
    : `Darkmoon Faire was last seen in ${where} ~${ago} ago - it moves weekly, so it may have moved on.`;
}
