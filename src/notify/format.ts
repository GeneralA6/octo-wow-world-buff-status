import type { RaidEvent } from "../watcher/raid-events.js";
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

/** Human list of the capitals a fresh buff could drop in ("Stormwind or Orgrimmar"). */
function cityList(cities: readonly Faction[]): string {
  const names = cities.map((faction) => CITY_FOR[faction]);
  if (names.length >= 2) return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return names[0] ?? "a capital";
}

/** The tips line — identical on the channel post and the in-game whisper, so a reader sees
 *  the same words wherever the drop reaches them. Gold is mailed in-game to `author`. */
function tipsLine(author: string): string {
  return `Did you get it? A tip to ${author} is appreciated.`;
}

/**
 * A raid reached strength — the buff is ~a clear-time away. `typicalClear` is the reader-facing
 * "usually 30-50m" range (or "~45m" before enough data), so a reader can judge whether to park
 * now or come back. Discord channel post; pings the open sides' roles via the `push` factions arg.
 */
export function formatBuffAlert(
  event: RaidEvent,
  cities: readonly Faction[],
  typicalClear?: string,
): NotifyMessage {
  const where = cityList(cities);
  if (event.kind === "raid-forming") {
    const id = event.number != null ? `Raid #${event.number}` : "A raid";
    const clear = typicalClear ? `, usually ${typicalClear} to clear` : "";
    return {
      kind: "entered",
      title: "🐲 Onyxia raid starting",
      body: `${id} formed${clear}. Park in ${where} for the Rallying Cry buff.`,
    };
  }
  // A confirmed clear (Chronicle Onyxia kill) vs an inferred one (roster departure). Both merge the
  // recap (number + duration) with the park CTA into ONE post — a clear can drop a buff any time,
  // so we still hedge with "may" unless the kill is confirmed.
  const id = event.number != null ? `Raid #${event.number}` : "A raid";
  const after = event.durationMs != null ? ` after ~${humanClock(event.durationMs)}` : "";
  const body =
    event.killConfirmed === true
      ? `${id} cleared${after} - Onyxia down, kill confirmed. Buff should drop in ${where} - park now.`
      : `${id} cleared${after}. Buff may drop in ${where} - park now.`;
  return { kind: "left", title: "🏁 Onyxia raid has ended", body };
}

/** A single terse in-game whisper line for a raid-start / raid-ended park alert. */
export function formatBuffWhisper(event: RaidEvent, cities: readonly Faction[], typicalClear?: string): string {
  const where = cityList(cities);
  if (event.kind === "raid-left") {
    return event.killConfirmed === true
      ? `Onyxia raid cleared - Onyxia down, kill confirmed. Buff should drop in ${where} - park now.`
      : `Onyxia raid cleared. Buff may drop in ${where} - park now.`;
  }
  const id = event.number != null ? `Raid #${event.number}` : "a raid";
  const clear = typicalClear ? `, usually ${typicalClear} to clear` : "";
  return `Onyxia raid starting (${id}${clear}). Park in ${where} for the Rallying Cry buff.`;
}

/**
 * The "about to clear" heads-up: a raid still in the lair has been in about as long as raids
 * usually take to clear, so a fresh Rallying Cry should drop soon when they finish — the pre-clear
 * "park NOW" moment, earlier than the reactive "ended" alert. `typicalClear` gives the reader the
 * spread so they can judge; the timing stays soft because clear times vary widely.
 */
export function formatRaidEnding(
  raidNumber: number | null,
  cities: readonly Faction[],
  elapsedMs: number,
  typicalClear?: string,
): NotifyMessage {
  const id = raidNumber !== null ? `Raid #${raidNumber}` : "A raid";
  const typical = typicalClear ? ` (typical clear ${typicalClear})` : "";
  return {
    kind: "entered",
    title: "⏰ Onyxia raid might end soon",
    body: `${id} has been in ~${humanClock(elapsedMs)}${typical}. Buff may drop soon - park in ${cityList(cities)} now.`,
  };
}

/** The terse in-game whisper twin of the about-to-clear heads-up. */
export function formatRaidEndingWhisper(
  raidNumber: number | null,
  cities: readonly Faction[],
  elapsedMs: number,
  typicalClear?: string,
): string {
  const num = raidNumber !== null ? `#${raidNumber} ` : "";
  const typical = typicalClear ? `, typical ${typicalClear}` : "";
  return `Onyxia raid ${num}might end soon (~${humanClock(elapsedMs)} in${typical}). Park in ${cityList(cities)} now for the buff.`;
}

/**
 * A raid that formed and got a "get ready to park" alert, but left too soon to have cleared
 * Onyxia — a disband, not a kill. Retracts the park heads-up so nobody waits for a buff that
 * isn't coming; `durationMs` shows how short it was. Only sent for the cities told to park.
 */
export function formatRaidDisbanded(
  raidNumber: number | null,
  cities: readonly Faction[],
  durationMs?: number,
): NotifyMessage {
  const id = raidNumber !== null ? `Raid #${raidNumber}` : "A raid";
  const after = durationMs != null ? ` after ~${humanClock(durationMs)}` : "";
  return {
    kind: "info",
    title: "🚫 Onyxia raid disbanded",
    body: `${id} left${after} without clearing. No buff coming. Stop parking in ${cityList(cities)}.`,
  };
}

/** The terse in-game whisper twin of the disband stand-down. */
export function formatRaidDisbandedWhisper(
  raidNumber: number | null,
  cities: readonly Faction[],
  durationMs?: number,
): string {
  const num = raidNumber !== null ? `#${raidNumber} ` : "";
  const after = durationMs != null ? ` (left after ~${humanClock(durationMs)})` : "";
  return `Onyxia raid ${num}disbanded${after}. No buff coming. Stop parking in ${cityList(cities)}.`;
}

/**
 * A buff just dropped (a listener heard the turn-in yell). Names the buff in full and the city.
 * No timestamp in the body — Discord stamps every message with its post time (= the drop time),
 * so a `<t:R>` here only renders "N hours ago" on scroll-back and contradicts the title. No
 * cooldown/duration line either — we track drops, not the buff on players.
 */
/**
 * The buff-drop channel post. When `savedHead` is set (no raid was in the lair when it dropped — see
 * `drop-origin.ts`), it appends one humble line explaining the drop came from a head turned in from
 * an earlier kill, so a reader understands why there was no heads-up. It takes no credit: a fresh
 * kill adds nothing here, because the park-now alert already served as the warning.
 */
export function formatBuffDropped(faction: Faction, author: string, savedHead = false): NotifyMessage {
  const city = CITY_FOR[faction];
  // The title already says the buff dropped and where. A fresh kill asks for a tip; a saved head
  // takes NO credit — the bot warned about nothing — so it drops the tip line and just explains why
  // there was no heads-up.
  const body = savedHead
    ? "This one's a saved Onyxia head from an earlier kill - no raid was in the lair, so there was no heads-up."
    : tipsLine(author);
  return {
    kind: "info",
    title: `🎉 Onyxia buff dropped in ${city}`,
    body,
  };
}

/** Plain-text in-game whisper of a buff drop, sent to that side's subscribers when the yell fires.
 *  A "light" (non-urgent) broadcast, so it carries the Discord nudge — in-game pings are throttled
 *  and can lag, Discord does not. `discordInvite` omitted leaves it off. */
export function formatBuffDroppedWhisper(
  faction: Faction,
  author: string,
  discordInvite?: string,
  savedHead = false,
): string {
  const cta = discordInvite ? ` In-game pings can lag - Discord is instant: ${discordInvite}` : "";
  // A saved head takes no credit — drop the tip ask, keep the buff line (the whisper has no title)
  // and the Discord CTA. A fresh kill keeps the tip.
  const tip = savedHead ? "" : ` ${tipsLine(author)}`;
  return `The Rallying Cry of the Dragonslayer just dropped in ${CITY_FOR[faction]}!${tip}${cta}`;
}

/**
 * ADVANCE heads-up: an addon on the LFT channel reported an Onyxia head being turned in (OB_INC),
 * so the Rallying Cry should drop in `faction`'s capital within moments — BEFORE the NPC yell. This
 * is the one thing /who and the yell can never give us early. `witness` is who the addon saw turning
 * it in (named for now, while this goes to the ops channel and the source addon has few users).
 */
export function formatHeadIncoming(faction: Faction, witness: string): NotifyMessage {
  const city = CITY_FOR[faction];
  return {
    kind: "info",
    title: `⚡ Onyxia buff incoming in ${city}`,
    body: `A head is being turned in now (${witness}) - the Rallying Cry should drop in ${city} within moments. Hearthstone or park in ${city} now to catch it.`,
  };
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
 * The periodic status board yelled in a capital: the raid in the lair (# and time in, with the
 * typical clear range so a passer-by can judge) and a park nudge — every clear can drop a fresh
 * buff — or, when empty, how a drop happens; and always a subscribe/discord CTA.
 */
export function formatCapitalStatusYell(
  faction: Faction,
  raid: CapitalStatusRaid | null,
  typicalClear?: string,
): string {
  const parts: string[] = [];
  if (raid) {
    const id = raid.number !== null ? `#${raid.number}, ` : "";
    const typical = typicalClear ? `, typical clear ${typicalClear}` : "";
    parts.push(
      `Onyxia raid in progress (${id}~${humanClock(raid.elapsedMs)} in${typical}). The Rallying Cry buff may drop soon - park here.`,
    );
  } else {
    parts.push(`No Onyxia raid right now. The Rallying Cry buff drops when a raid clears.`);
  }
  parts.push(`Whisper "subscribe" for pings, "discord" for discord notifications.`);
  return `[Onyxia] ${parts.join(" ")}`;
}

// The realm down/up notification moved OUT of this (buff) channel: it is now a transient,
// self-deleting notice in the dedicated #server-status channel — see serverDownNotice /
// serverUpNotice and ServerStatusWidget.announce in status-widget.ts.
