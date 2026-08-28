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

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
