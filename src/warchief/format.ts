import { humanClock } from "../notify/format.js";
import { dominantGuild } from "../watcher/raid-events.js";
import type { Attribution, BlessingOutlook, ForecastEvaluation } from "./forecast.js";
import type { SpireRun, SpireRunEndReason } from "./spire-runs.js";

/**
 * Wording for the Warchief's Blessing SHADOW forecast: what the Spire watch saw and how its guesses
 * held up, for the tests channel while it is being tuned — never for players. Every title says
 * "shadow" so no one mistakes a guess for an alert.
 */

export interface ShadowNotice {
  readonly title: string;
  readonly body: string;
}

/** A Discord timestamp at a moment, shown in each reader's own clock ("21:04"). */
const at = (ms: number): string => `<t:${Math.floor(ms / 1000)}:t>`;

/** A duration that may be negative ("-12m"), which `humanClock` clamps to zero. */
export function signedClock(ms: number): string {
  return ms < 0 ? `-${humanClock(-ms)}` : humanClock(ms);
}

function who(run: SpireRun, horde: number): string {
  const guild = dominantGuild(run.roster);
  const mostly = guild && guild.count * 2 > run.roster.length ? `, mostly <${guild.guild}>` : "";
  return `${run.roster.length} players (${horde} Horde${mostly})`;
}

export function formatRunStarted(run: SpireRun, horde: number): ShadowNotice {
  const since = run.baseline ? `already inside when we looked at ${at(run.formedAt)}` : `in together from ${at(run.startedAt)}`;
  const outlook =
    horde > 0
      ? "Rend can fall from ~10m in, and the blessing follows once a Horde member turns Rend's head in."
      : "No Horde among them, so no blessing can come of it.";
  return {
    title: "🔥 UBRS run in Blackrock Spire (shadow)",
    body: `${who(run, horde)} ${since}. ${outlook}`,
  };
}

export function formatRunEnded(
  run: SpireRun,
  endedAt: number,
  reason: SpireRunEndReason,
  horde: number,
  outlook: BlessingOutlook,
): ShadowNotice {
  const title = "🏁 UBRS run left Blackrock Spire (shadow)";
  if (reason === "stale") {
    return { title, body: `${who(run, horde)} still inside after ${humanClock(endedAt - run.startedAt)} - idlers, not a raid. No forecast.` };
  }
  const left =
    reason === "blind"
      ? `lost across a gap in our readings; last seen at strength ${at(endedAt)}`
      : `left after ${humanClock(endedAt - run.startedAt)} (peak ${run.peak})`;
  const basis = outlook.learned
    ? `most blessings have come within ${humanClock(outlook.withinMs)} of a run leaving`
    : `a first guess of ${humanClock(outlook.withinMs)}, until enough blessings are seen`;
  const forecast =
    horde > 0
      ? `If the head goes in, the Warchief's Blessing should land by ~${at(endedAt + outlook.withinMs)} (${basis}).`
      : "No Horde among them, so no blessing is expected.";
  return { title, body: `${who(run, horde)} ${left}. ${forecast}` };
}

/** How the blessing just heard squares with the forecast, and the score so far. */
export function formatBlessingVerdict(
  attribution: Attribution,
  midRun: SpireRun | null,
  outlook: BlessingOutlook,
  score: ForecastEvaluation,
): ShadowNotice {
  let verdict: string;
  if (attribution.run !== null) {
    const run = attribution.run;
    verdict =
      attribution.lagMs < 0
        ? `Dropped while the run from ${at(run.startedAt)} was still inside.`
        : `Came ${humanClock(attribution.lagMs)} after the run from ${at(run.startedAt)} left - ` +
          `${attribution.lagMs <= outlook.withinMs ? "inside" : "outside"} the ${humanClock(outlook.withinMs)} window.`;
  } else if (midRun !== null) {
    verdict = `Dropped ${humanClock(attribution.dropAt - midRun.startedAt)} into the run still inside (from ${at(midRun.startedAt)}).`;
  } else {
    verdict = "No Spire run explains it - a saved head, or a run the watch missed.";
  }
  return { title: "⚔️ Warchief's Blessing vs the forecast (shadow)", body: `${verdict}\n${formatScore(score)}` };
}

/** The forecast's record so far, in one line. */
export function formatScore(score: ForecastEvaluation): string {
  const lag = score.lag
    ? `; run-left-to-blessing median ${signedClock(score.lag.medianMs)} ` +
      `(p25 ${signedClock(score.lag.p25Ms)}, p75 ${signedClock(score.lag.p75Ms)}, p90 ${signedClock(score.lag.p90Ms)})`
    : "";
  return (
    `Score: ${score.attributed}/${score.drops} blessings explained by a Spire run (${score.midRun} mid-run), ` +
    `${score.runsWithDrop}/${score.runs} Horde runs led to one${lag}.`
  );
}
