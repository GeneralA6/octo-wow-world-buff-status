import type { RaidEvent } from "../watcher/raid-tracker.js";
import type { Faction } from "../watcher/buff-store.js";
import type { NotifyMessage } from "./notifier.js";

/** The capital whose buff a faction's turn-in drops. */
const CITY_FOR: Record<Faction, string> = { alliance: "Stormwind", horde: "Orgrimmar" };

/** "2h" for whole hours, else "90 min". */
function humanDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m % 60 === 0 ? `${m / 60}h` : `${m} min`;
}

/**
 * A buff just dropped (a listener heard the yell). Says which city it's up in and,
 * crucially, the earliest a fresh one can drop again — which is when this one wears
 * off, since a hanging head blocks the next turn-in. Discord dynamic timestamps
 * (`<t:unix:t>` / `<t:unix:R>`) render in each viewer's own timezone and stay live.
 */
export function formatBuffDropped(faction: Faction, appliedAt: Date, durationMs: number): NotifyMessage {
  const city = CITY_FOR[faction];
  const expiresUnix = Math.floor((appliedAt.getTime() + durationMs) / 1000);
  return {
    kind: "info",
    title: `🎉 Rallying Cry is up in ${city}`,
    body:
      `The Rallying Cry of the Dragonslayer just dropped in ${city} - good for ~${humanDuration(durationMs)}, ` +
      `until <t:${expiresUnix}:t> (<t:${expiresUnix}:R>). ` +
      `That's also the earliest a fresh one can drop, so start watching again then.`,
  };
}

/** Plain-text in-game whisper of a buff drop — no absolute time (the bot's clock isn't
 *  the player's, and WoW can't render Discord timestamps), a duration instead. Sent to
 *  that side's subscribers when the yell fires. */
export function formatBuffDroppedWhisper(faction: Faction, durationMs: number): string {
  const city = CITY_FOR[faction];
  return (
    `The Rallying Cry of the Dragonslayer just dropped in ${city}! ` +
    `The next can't drop for at least ${humanDuration(durationMs)}, usually longer - I'll warn you before it does.`
  );
}

/** The full tuning hint: how to pick a side, and how to stop. Sent once, on the subscribe
 *  confirmation — the natural onboarding moment, not on every alert. */
export const FACTION_FILTER_HINT =
  `Only want one side's buffs? Whisper Bufftracker "alliance" or "horde" in-game and I'll ping you for just that faction (or "both" for all). Whisper "unsubscribe" to stop alerts.`;

/** A short faction-only nudge for the recurring cooldown post — no unsubscribe, kept brief
 *  because it rides on every ~2h refresh. */
export const FACTION_HINT_SHORT =
  `Only want one side? Whisper Bufftracker "alliance" or "horde" and I'll ping just that faction.`;

/**
 * The buff's window just elapsed, so a fresh one can drop again. Discord channel post.
 * Names the full buff and ties it to Onyxia, so a reader who wasn't following knows
 * exactly which buff this is and where it comes from. `includeFilterHint` appends the
 * short faction nudge — true for the public channel post, but set false for a DM to a
 * subscriber who has already chosen a single side (don't nag them about it).
 */
export function formatBuffCooldownRefreshed(faction: Faction, includeFilterHint = true): NotifyMessage {
  const city = CITY_FOR[faction];
  const body =
    `The last Rallying Cry of the Dragonslayer (the Onyxia world buff) in ${city} has worn off, ` +
    `so a fresh one can drop again as soon as a raid clears Onyxia and turns in the head. ` +
    `Park up in ${city} if you want to catch it.`;
  return {
    kind: "info",
    title: `🔄 Rallying Cry of the Dragonslayer can drop again in ${city}`,
    body: includeFilterHint ? `${body}\n\n${FACTION_HINT_SHORT}` : body,
  };
}

/** Plain in-game line (whisper or yell) that the cooldown is up. Spells out the full buff
 *  name and its Onyxia source, since a city yell reaches people who weren't following. */
export function formatBuffCooldownRefreshedWhisper(faction: Faction): string {
  const city = CITY_FOR[faction];
  return (
    `Heads up - the Rallying Cry of the Dragonslayer (the Onyxia world buff) can drop again in ${city}: ` +
    `the last one just wore off, so the next Onyxia clear can hand it out. Park up to catch it!`
  );
}

/** A player's feedback/suggestion, as a plain Discord-channel message that names the
 *  sender and their realm. Posted via the bot (not the webhook), so it's plain content
 *  with markdown. */
export function formatFeedbackPost(from: string, text: string, server?: string): string {
  const who = server ? `${from} (${server})` : from;
  return `💬 **Suggestion from ${who}:**\n${text}`;
}

/** Human list of the capitals where a fresh buff is possible ("Stormwind or Orgrimmar"). */
function cityList(cities: readonly Faction[]): string {
  const names = cities.map((faction) => CITY_FOR[faction]);
  if (names.length >= 2) return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return names[0] ?? "a capital";
}

/** Turn a raid event into a human-readable notification for the given zone. */
export function formatRaidEvent(event: RaidEvent, areaName: string): NotifyMessage {
  switch (event.kind) {
    case "raid-forming": {
      const { label, count } = event.cohort;
      if (event.initial) {
        return {
          kind: "entered",
          title: `🐉 Raid in ${areaName}`,
          body: `${label} is already ${count} strong in ${areaName}.`,
        };
      }
      return {
        kind: "entered",
        title: `🐉 Raid forming in ${areaName}`,
        body: `${label} just reached ${count} in ${areaName} - a raid is about to start.`,
      };
    }
    case "raid-left": {
      const { label, peak } = event.cohort;
      return {
        kind: "left",
        title: `✅ Raid left ${areaName}`,
        body: `${label} has cleared out of ${areaName} (peaked ${peak} ${plural(peak, "player")}).`,
      };
    }
  }
}

/** A single terse line for an in-game whisper (no markup, well under the length cap). */
export function formatRaidWhisper(event: RaidEvent, areaName: string): string {
  if (event.kind === "raid-left") {
    return `${event.cohort.label} has left ${areaName} (peaked ${event.cohort.peak}).`;
  }
  const { label, count } = event.cohort;
  return event.initial
    ? `A raid is already underway in ${areaName}: ${label} (${count}).`
    : `${label} is forming in ${areaName} (${count}) - a raid is about to start!`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/**
 * A buff-parking alert: a raid could soon produce a fresh Rallying Cry, so head to a
 * capital where the buff can actually drop. `cities` are the capitals whose buff has
 * (or will have, by the time the raid clears) expired — the ones worth parking in.
 * Only produced once the gate has decided a fresh buff is possible somewhere.
 */
export function formatBuffAlert(event: RaidEvent, cities: readonly Faction[], areaName: string): NotifyMessage {
  const where = cityList(cities);
  if (event.kind === "raid-forming") {
    const verb = event.initial ? "is underway" : "is forming";
    return {
      kind: "entered",
      title: "🐉 Rallying Cry may be coming",
      body:
        `A raid ${verb} in ${areaName} (${event.cohort.count}). ` +
        `A Rallying Cry buff may drop in ${where} when they clear it and turn in the head - ` +
        `get ready to park.`,
    };
  }
  return {
    kind: "left",
    title: "⏳ Rallying Cry may drop soon",
    body:
      `A raid just cleared ${areaName} (peaked ${event.cohort.peak}). ` +
      `Park in ${where} now to catch the Rallying Cry when the head is turned in.`,
  };
}

/** A single terse in-game whisper line for a buff-parking alert. */
export function formatBuffWhisper(event: RaidEvent, cities: readonly Faction[], areaName: string): string {
  const where = cityList(cities);
  if (event.kind === "raid-left") {
    return `A raid just cleared ${areaName} - park in ${where} for a possible Rallying Cry buff.`;
  }
  const verb = event.initial ? "underway" : "forming";
  return `A raid is ${verb} in ${areaName} (${event.cohort.count}) - get ready to park in ${where} for the buff.`;
}
