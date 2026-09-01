import type { RaidEvent } from "../watcher/raid-tracker.js";
import type { Faction } from "../watcher/buff-store.js";
import type { NotifyMessage } from "./notifier.js";

/** The capital whose buff a faction's turn-in drops. */
export const CITY_FOR: Record<Faction, string> = { alliance: "Stormwind", horde: "Orgrimmar" };

/** "2h" for whole hours, else "90 min". */
function humanDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m % 60 === 0 ? `${m / 60}h` : `${m} min`;
}

/** Compact clock duration: "42m", "1h22m", "2h" — for status/yells/recaps. */
export function humanClock(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h${rem}m`;
}

/** A raid the ClearTracker confirmed as really finished — informational recap with the
 *  reference number and how long it took (spanning any wipes). Discord channel post.
 *  `buffPossible` gates the buff hint on the same check the park-now alert uses: when the
 *  buff is already up (a raid turned in a saved head before it left, so the drop landed
 *  before the clear confirmed), promising a fresh one "soon" is stale — say it's up instead. */
export function formatRaidFinished(
  raidNumber: number | null,
  durationMs: number,
  areaName: string,
  buffPossible = true,
): NotifyMessage {
  const id = raidNumber !== null ? `Raid #${raidNumber}` : "A raid";
  const tail = buffPossible
    ? "A Rallying Cry may drop soon once the head is turned in."
    : "The Rallying Cry is already up.";
  return {
    kind: "info",
    title: `🏁 ${id} cleared ${areaName}`,
    body: `${id} cleared ${areaName} after ~${humanClock(durationMs)}. ${tail}`,
  };
}

/**
 * A buff just dropped (a listener heard the yell). Says which city it's up in and,
 * crucially, the earliest a fresh one can drop again — which is when this one wears
 * off, since a hanging head blocks the next turn-in. Discord dynamic timestamps
 * (`<t:unix:t>` / `<t:unix:R>`) render in each viewer's own timezone and stay live.
 */
/** The tips line — identical on the channel post and the in-game whisper, so a reader sees
 *  the same words wherever the drop reaches them. Gold is mailed in-game to `author`. */
function tipsLine(author: string): string {
  return `Did you get it? A tip to ${author} is appreciated.`;
}

export function formatBuffDropped(faction: Faction, appliedAt: Date, durationMs: number, author: string): NotifyMessage {
  const expiresUnix = Math.floor((appliedAt.getTime() + durationMs) / 1000);
  return {
    kind: "info",
    title: `🎉 Rallying Cry just dropped in ${CITY_FOR[faction]}`,
    body:
      `A ${humanDuration(durationMs)} cooldown has started, until <t:${expiresUnix}:t> (<t:${expiresUnix}:R>). ` +
      tipsLine(author),
  };
}

/** Plain-text in-game whisper of a buff drop — no absolute time (the bot's clock isn't
 *  the player's, and WoW can't render Discord timestamps), a duration instead. Sent to
 *  that side's subscribers when the yell fires. */
export function formatBuffDroppedWhisper(faction: Faction, durationMs: number, author: string): string {
  const city = CITY_FOR[faction];
  return (
    `The Rallying Cry of the Dragonslayer just dropped in ${city}! ` +
    `The next can't drop for at least ${humanDuration(durationMs)}, usually longer - I'll alert you before it does. ` +
    tipsLine(author)
  );
}

/**
 * The buff's window just elapsed, so a fresh one can drop again. Discord channel post, kept
 * short: the title says it's off cooldown, the body names the two ways it can drop (a held head
 * turned in now, or the next clear) and closes with the live lair status. `raid` is the raid in
 * progress for this faction's lair, or null if none.
 */
export function formatBuffCooldownRefreshed(
  faction: Faction,
  raid: CapitalStatusRaid | null,
  areaName: string,
): NotifyMessage {
  const status = raid
    ? `A raid's in ${areaName} now (${raid.number !== null ? `raid #${raid.number}, ` : ""}in for ~${humanClock(raid.elapsedMs)}).`
    : `Currently no raid in ${areaName}.`;
  return {
    kind: "info",
    title: `🔄 Onyxia buff off cooldown in ${CITY_FOR[faction]}`,
    body: `A fresh one can drop any time now - from a saved head or the next clear. ${status}`,
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

/** Guild-chat (/g) line welcoming a member who just accepted an invite. Everyone reading it is
 *  already in the guild, so it names no guild — short and warm. */
export function formatGuildWelcome(name: string): string {
  return `Welcome to the guild, ${name}! 🎉`;
}

/** A player's feedback/suggestion, as a plain Discord-channel message that names the
 *  sender and their realm. Posted via the bot (not the webhook), so it's plain content
 *  with markdown. */
export function formatFeedbackPost(from: string, text: string, server?: string): string {
  const who = server ? `${from} (${server})` : from;
  return `💬 **Suggestion from ${who}:**\n${text}`;
}

export interface CapitalStatusRaid {
  readonly number: number | null;
  readonly elapsedMs: number;
}

/**
 * The periodic status board yelled in a capital. Leads by NAMING the buff, so a passer-by who
 * wasn't following knows what these alerts are for; then the cooldown clock while a buff is up,
 * then the raid in the lair (# and time in) with a "park" nudge ONLY when a fresh buff is
 * genuinely possible at their clear (the buff-gate decision), and always a subscribe/discord CTA.
 * `cooldownActiveMsLeft` is ms until the current buff wears off (a fresh one can then drop), or
 * null if one can drop now.
 */
export function formatCapitalStatusYell(
  faction: Faction,
  cooldownActiveMsLeft: number | null,
  raid: CapitalStatusRaid | null,
  buffPossible: boolean,
): string {
  const city = CITY_FOR[faction];
  // Lead: name the buff up front - the message is otherwise vague about what it's alerting on.
  const parts: string[] = [`Rallying Cry world buff:`];
  // Cooldown: state the timer only while a buff is UP. Ready needs no mention (it's the norm).
  if (cooldownActiveMsLeft !== null) {
    parts.push(`up in ${city}, ~${humanClock(cooldownActiveMsLeft)} until a fresh one can drop.`);
  }
  // Raid: only when one is in the lair, with a park nudge when a fresh buff is genuinely possible.
  if (raid) {
    const id = raid.number !== null ? `raid #${raid.number}, ` : "";
    parts.push(
      buffPossible
        ? `A raid's in the lair (${id}in for ~${humanClock(raid.elapsedMs)}) - one may drop when they clear, park here!`
        : `A raid's in the lair (${id}in for ~${humanClock(raid.elapsedMs)}).`,
    );
  }
  parts.push(`Whisper "subscribe" for pings, "discord" for discord notifications.`);
  return `[Onyxia] ${parts.join(" ")}`;
}

/** Human list of the capitals where a fresh buff is possible ("Stormwind or Orgrimmar"). */
function cityList(cities: readonly Faction[]): string {
  const names = cities.map((faction) => CITY_FOR[faction]);
  if (names.length >= 2) return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return names[0] ?? "a capital";
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
    // Fires when the raid reaches strength and gets its number (via formedRaidEvent), so it can
    // name the raid the same #N its clear will — not the raw member count, which meant nothing.
    const id = event.number != null ? `Raid #${event.number}` : "A raid";
    return {
      kind: "entered",
      title: "🐉 Rallying Cry may be coming",
      body:
        `${id} has formed in ${areaName}. ` +
        `A Rallying Cry buff may drop in ${where} when they clear it and turn in the head - ` +
        `get ready to park.`,
    };
  }
  // A Chronicle Onyxia kill confirmed the clear (not just inferred from the /who departure), so
  // the buff is genuinely coming — say so, and drop the "may".
  const confirmed = event.killConfirmed === true;
  return {
    kind: "left",
    title: confirmed ? "🏆 Rallying Cry incoming - Onyxia down" : "⏳ Rallying Cry may drop soon",
    body: confirmed
      ? `A raid just downed Onyxia in ${areaName} (peaked ${event.cohort.peak}) - kill confirmed. ` +
        `Park in ${where} now to catch the Rallying Cry when the head is turned in.`
      : `A raid just cleared ${areaName} (peaked ${event.cohort.peak}). ` +
        `Park in ${where} now to catch the Rallying Cry when the head is turned in.`,
  };
}

/** A single terse in-game whisper line for a buff-parking alert. */
export function formatBuffWhisper(event: RaidEvent, cities: readonly Faction[], areaName: string): string {
  const where = cityList(cities);
  if (event.kind === "raid-left") {
    return event.killConfirmed === true
      ? `A raid just downed Onyxia in ${areaName} (kill confirmed) - park in ${where} for the Rallying Cry buff.`
      : `A raid just cleared ${areaName} - park in ${where} for a possible Rallying Cry buff.`;
  }
  const id = event.number != null ? `Raid #${event.number}` : "A raid";
  return `${id} has formed in ${areaName} - get ready to park in ${where} for the buff.`;
}

/**
 * The highest-value "go park NOW" moment: a raid is in the lair AND the buff is about to wear
 * off, so a fresh Rallying Cry is imminent — it'll drop the moment they clear and turn in the
 * head. Distinct from the forming heads-up (which fires early, at form), the off-cooldown alert
 * (at expiry) and the cleared alert (at the clear); this is the pre-expiry convergence, the
 * window to head to the capital before the refresh lands. Discord channel post.
 */
export function formatBuffImminent(
  faction: Faction,
  raidNumber: number | null,
  buffMsLeft: number,
  areaName: string,
): NotifyMessage {
  const id = raidNumber != null ? `Raid #${raidNumber}` : "A raid";
  const city = CITY_FOR[faction];
  return {
    kind: "entered",
    title: `🔥 Rallying Cry buff imminent in ${city}`,
    body:
      `${id} is in ${areaName} and the buff wears off in ~${humanClock(buffMsLeft)} - ` +
      `a fresh Rallying Cry should drop in ${city} the moment they clear. Park now to catch it.`,
  };
}

/** The terse in-game whisper twin of the buff-imminent alert. */
export function formatBuffImminentWhisper(faction: Faction, buffMsLeft: number): string {
  return (
    `${CITY_FOR[faction]} buff wears off in ~${humanClock(buffMsLeft)} and a raid's in the lair - ` +
    `park now to catch the fresh Rallying Cry.`
  );
}
