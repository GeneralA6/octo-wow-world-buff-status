import { humanSpan } from "../notify/format.js";
import type { FaireReport } from "./resolve.js";

/**
 * The whisper `/darkmoon` answers with. One line, like every other whisper the bot sends — a
 * chatty bot is a reported bot.
 *
 * The wording carries the bot's actual confidence rather than flattening it:
 *
 *   is up      — a player saw it, or a past sighting has pinned the alternation
 *   should be  — nobody has ever confirmed a faire on this realm, so the zone is still the
 *                vanilla assumption the calendar shipped with
 *
 * Telling a player to fly to Mulgore is cheap to get wrong once and expensive to keep getting
 * wrong, so an unconfirmed answer says so instead of sounding certain.
 */
export function formatFaire(report: FaireReport, now: number): string {
  const where = `${report.site.zone} (${report.site.landmark})`;
  const sure = report.source === "sighting" || report.locationConfirmed;

  if (report.phase === "up") {
    // A live sighting on a day the calendar calls quiet leaves us with no closing time to quote,
    // so we date the sighting instead of inventing a window.
    const when =
      report.closesAt !== null
        ? `closes in ~${humanSpan(report.closesAt - now)}`
        : report.sighting !== null
          ? `last seen ~${humanSpan(now - report.sighting.sightedAt)} ago`
          : null;
    const tail = when === null ? "" : ` - ${when}`;
    return `Darkmoon Faire is${sure ? "" : " probably"} up in ${where}${tail}.`;
  }

  const opens = report.opensAt !== null ? ` in ~${humanSpan(report.opensAt - now)}` : "";
  return sure
    ? `Darkmoon Faire is travelling. Next stop ${where}${opens}.`
    : `Darkmoon Faire is travelling. Next stop should be ${where}${opens}.`;
}
