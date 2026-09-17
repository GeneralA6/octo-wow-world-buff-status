import { humanSpan } from "../notify/format.js";
import type { FaireReport } from "./resolve.js";

/**
 * The whisper `/darkmoon` answers with. One line, like every other whisper the bot sends — a
 * chatty bot is a reported bot.
 *
 * Two things the wording refuses to flatten:
 *
 *   - SETTING UP is not UP. The tents and NPCs are in the zone for three days before the faire
 *     opens for business, so a player who rides out on the strength of "it's up" finds carnies
 *     who will not take their tickets. The line says which it is, and when it opens.
 *   - "is" versus "probably". A zone confirmed by a herald or a sighting is stated plainly; a zone
 *     that is still the shipped assumption hedges. Sending someone to the wrong continent is cheap
 *     to get wrong once and expensive to keep getting wrong.
 */
export function formatFaire(report: FaireReport, now: number): string {
  const where = `${report.site.zone} (${report.site.landmark})`;
  const sure = report.source === "sighting" || report.confirmedBy !== null;
  const hedge = sure ? "" : " probably";

  if (report.phase === "setting-up") {
    const opens = report.opensAt !== null ? ` - opens in ~${humanSpan(report.opensAt - now)}` : "";
    return `Darkmoon Faire is${hedge} setting up in ${where}${opens}.`;
  }

  if (report.phase === "up") {
    // A live sighting on a day the calendar calls quiet leaves us with no closing time to quote,
    // so we date the sighting instead of inventing a window.
    const when =
      report.closesAt !== null
        ? `closes in ~${humanSpan(report.closesAt - now)}`
        : report.sighting !== null
          ? `last seen ~${humanSpan(now - report.sighting.observedAt)} ago`
          : null;
    return `Darkmoon Faire is${hedge} up in ${where}${when === null ? "" : ` - ${when}`}.`;
  }

  // Travelling: the next stop is what a player can act on, and setup is when it becomes visitable
  // ground — but "opens" is the date that matters for tickets, so that is the one quoted.
  const opens = report.opensAt !== null ? ` in ~${humanSpan(report.opensAt - now)}` : "";
  return sure
    ? `Darkmoon Faire is travelling. Next stop ${where}${opens}.`
    : `Darkmoon Faire is travelling. Next stop should be ${where}${opens}.`;
}
