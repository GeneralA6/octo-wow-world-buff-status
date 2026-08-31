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
      `The Rallying Cry of the Dragonslayer just dropped in ${city} — good for ~${humanDuration(durationMs)}, ` +
      `until <t:${expiresUnix}:t> (<t:${expiresUnix}:R>). ` +
      `That's also the earliest a fresh one can drop, so start watching again then.`,
  };
}

/** Plain-text in-game whisper of a buff drop — no Discord timestamps (WoW can't render
 *  them), a clock time instead. Sent to that side's subscribers when the yell fires. */
export function formatBuffDroppedWhisper(faction: Faction, appliedAt: Date, durationMs: number): string {
  const city = CITY_FOR[faction];
  const expires = new Date(appliedAt.getTime() + durationMs);
  const hhmm = `${expires.getHours().toString().padStart(2, "0")}:${expires.getMinutes().toString().padStart(2, "0")}`;
  return (
    `The Rallying Cry just dropped in ${city}! Good for ~${humanDuration(durationMs)} (until about ${hhmm} server time) — ` +
    `go grab it. That's also the earliest the next one can drop.`
  );
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
        body: `${label} just reached ${count} in ${areaName} — a raid is about to start.`,
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
    : `${label} is forming in ${areaName} (${count}) — a raid is about to start!`;
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
        `A Rallying Cry buff may drop in ${where} when they clear it and turn in the head — ` +
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
    return `A raid just cleared ${areaName} — park in ${where} for a possible Rallying Cry buff.`;
  }
  const verb = event.initial ? "underway" : "forming";
  return `A raid is ${verb} in ${areaName} (${event.cohort.count}) — get ready to park in ${where} for the buff.`;
}
