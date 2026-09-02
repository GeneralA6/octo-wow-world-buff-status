import type { RaidEvent } from "../watcher/raid-tracker.js";
import type { Faction } from "../watcher/buff-store.js";
import type { NotifyMessage } from "./notifier.js";

/** The capital whose buff a faction's turn-in drops. */
export const CITY_FOR: Record<Faction, string> = { alliance: "Stormwind", horde: "Orgrimmar" };

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
 *  Every clear can produce a fresh Rallying Cry (no re-drop lockout on this server), so
 *  the hint is unconditional. */
export function formatRaidFinished(
  raidNumber: number | null,
  durationMs: number,
  areaName: string,
): NotifyMessage {
  const id = raidNumber !== null ? `Raid #${raidNumber}` : "A raid";
  return {
    kind: "info",
    title: `🏁 ${id} cleared ${areaName}`,
    body: `${id} cleared ${areaName} after ~${humanClock(durationMs)}. A Rallying Cry may drop soon once the head is turned in.`,
  };
}

/** A raid that formed and got a "get ready to park" alert, but left too soon to have cleared
 *  Onyxia — a disband, not a kill. Retracts the park heads-up so nobody waits for a buff that
 *  isn't coming. Only sent for the cities that were told to park. Discord channel post. */
export function formatRaidDisbanded(
  raidNumber: number | null,
  cities: readonly Faction[],
  areaName: string,
): NotifyMessage {
  const id = raidNumber !== null ? `Raid #${raidNumber}` : "The raid";
  return {
    kind: "info",
    title: `🚫 ${id} disbanded`,
    body: `${id} left ${areaName} without clearing it - no Rallying Cry coming from that one. You can stop parking in ${cityList(cities)}.`,
  };
}

/** The terse in-game whisper twin of the disband stand-down. */
export function formatRaidDisbandedWhisper(
  raidNumber: number | null,
  cities: readonly Faction[],
  areaName: string,
): string {
  const id = raidNumber !== null ? `Raid #${raidNumber}` : "The raid";
  return `${id} left ${areaName} without clearing - no buff coming, you can stop parking in ${cityList(cities)}.`;
}

/** The tips line — identical on the channel post and the in-game whisper, so a reader sees
 *  the same words wherever the drop reaches them. Gold is mailed in-game to `author`. */
function tipsLine(author: string): string {
  return `Did you get it? A tip to ${author} is appreciated.`;
}

/**
 * A buff just dropped (a listener heard the turn-in yell). Says which city it's up in, with a
 * live relative timestamp of the drop itself (`<t:unix:R>` renders in each viewer's timezone).
 * No "good for 2h" / cooldown line — we track drops, not the buff on players, and a fresh one
 * can drop again on the next clear.
 */
export function formatBuffDropped(faction: Faction, appliedAt: Date, author: string): NotifyMessage {
  const droppedUnix = Math.floor(appliedAt.getTime() / 1000);
  return {
    kind: "info",
    title: `🎉 Rallying Cry just dropped in ${CITY_FOR[faction]}`,
    body:
      `The Rallying Cry of the Dragonslayer is up in ${CITY_FOR[faction]} (dropped <t:${droppedUnix}:R>). ` +
      tipsLine(author),
  };
}

/** Plain-text in-game whisper of a buff drop, sent to that side's subscribers when the yell
 *  fires. No cooldown claim — I'll alert them again when the next one's on the way. */
export function formatBuffDroppedWhisper(faction: Faction, author: string): string {
  const city = CITY_FOR[faction];
  return (
    `The Rallying Cry of the Dragonslayer just dropped in ${city}! ` +
    `I'll alert you when the next one's on the way. ` +
    tipsLine(author)
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
 * wasn't following knows what these alerts are for; then the raid in the lair (# and time in)
 * with a "park" nudge — every clear can drop a fresh Rallying Cry, so a raid present always
 * means one may be coming — or, when the lair is empty, how a drop happens; and always a
 * subscribe/discord CTA. No cooldown clock: we track drops, not the buff on players.
 */
export function formatCapitalStatusYell(faction: Faction, raid: CapitalStatusRaid | null): string {
  // Lead: name the buff up front - the message is otherwise vague about what it's alerting on.
  const parts: string[] = [`Rallying Cry world buff:`];
  if (raid) {
    const id = raid.number !== null ? `raid #${raid.number}, ` : "";
    parts.push(`A raid's in the lair (${id}in for ~${humanClock(raid.elapsedMs)}) - one may drop when they clear, park here!`);
  } else {
    parts.push(`a fresh one drops when a raid clears Onyxia. No raid in the lair right now.`);
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
 * The "about to clear" heads-up: a raid still in the lair has been in about as long as raids
 * usually take to clear, so a fresh Rallying Cry should drop soon when they finish. The pre-clear
 * "park NOW" moment — earlier than the reactive "cleared" alert. Fired once per cycle. Discord
 * channel post. Timing is soft ("about to clear", not a precise ETA) because clear times vary
 * widely, so a promised minute count would often be wrong.
 */
export function formatRaidEnding(
  raidNumber: number | null,
  cities: readonly Faction[],
  elapsedMs: number,
  areaName: string,
): NotifyMessage {
  const id = raidNumber !== null ? `Raid #${raidNumber}` : "A raid";
  const where = cityList(cities);
  return {
    kind: "entered",
    title: `⏰ ${id} about to clear ${areaName}`,
    body:
      `${id} has been in ${areaName} ~${humanClock(elapsedMs)} - about how long raids take to clear. ` +
      `A fresh Rallying Cry should drop in ${where} soon; park now to catch it.`,
  };
}

/** The terse in-game whisper twin of the about-to-clear heads-up. */
export function formatRaidEndingWhisper(
  raidNumber: number | null,
  cities: readonly Faction[],
  elapsedMs: number,
  areaName: string,
): string {
  const id = raidNumber !== null ? `Raid #${raidNumber}` : "A raid";
  return `${id} is ~${humanClock(elapsedMs)} into ${areaName} and about to clear - park in ${cityList(cities)} now, the Rallying Cry should drop soon.`;
}
