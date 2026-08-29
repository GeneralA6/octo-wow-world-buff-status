import type { RaidEvent } from "../watcher/raid-tracker.js";
import type { NotifyMessage } from "./notifier.js";

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
