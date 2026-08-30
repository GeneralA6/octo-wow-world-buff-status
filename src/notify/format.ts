import type { RaidEvent } from "../watcher/raid-tracker.js";
import type { Faction } from "../watcher/buff-store.js";
import type { NotifyMessage } from "./notifier.js";

/** The capital whose buff a faction's turn-in drops. */
const CITY_FOR: Record<Faction, string> = { alliance: "Stormwind", horde: "Orgrimmar" };
const SIDE_FOR: Record<Faction, string> = { alliance: "Alliance", horde: "Horde" };

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
 * A buff-parking alert: a raid could soon produce a fresh Rallying Cry for a faction,
 * so its members should head to that faction's capital. Only ever produced once the
 * gate has decided a fresh buff is actually possible, hence the confident "get ready".
 */
export function formatBuffAlert(event: RaidEvent, faction: Faction, areaName: string): NotifyMessage {
  const city = CITY_FOR[faction];
  const side = SIDE_FOR[faction];
  if (event.kind === "raid-forming") {
    const verb = event.initial ? "is underway" : "is forming";
    return {
      kind: "entered",
      title: `🐉 ${side} buff may be coming`,
      body:
        `A ${side} raid ${verb} in ${areaName} (${event.cohort.count}). ` +
        `If they down Onyxia and turn in the head, the ${city} Rallying Cry buff drops — ` +
        `get ready to park in ${city}.`,
    };
  }
  return {
    kind: "left",
    title: `⏳ ${side} buff may drop soon`,
    body:
      `A ${side} raid just cleared ${areaName} (peaked ${event.cohort.peak}). ` +
      `Head to ${city} now to catch the Rallying Cry when the head is turned in.`,
  };
}

/** A single terse in-game whisper line for a buff-parking alert. */
export function formatBuffWhisper(event: RaidEvent, faction: Faction, areaName: string): string {
  const city = CITY_FOR[faction];
  const side = SIDE_FOR[faction];
  if (event.kind === "raid-left") {
    return `A ${side} raid just cleared ${areaName} — park in ${city} for a possible Rallying Cry buff.`;
  }
  const verb = event.initial ? "underway" : "forming";
  return `A ${side} raid is ${verb} in ${areaName} (${event.cohort.count}) — get ready to park in ${city} for the buff.`;
}
