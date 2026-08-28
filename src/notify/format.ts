import { dominantGuild, type WatchEvent } from "../watcher/onyxia-watcher.js";
import type { NotifyMessage } from "./notifier.js";

/** Turn a watch event into a human-readable notification for the given zone. */
export function formatEvent(event: WatchEvent, areaName: string): NotifyMessage {
  switch (event.kind) {
    case "raid-entered": {
      const count = event.players.length;
      const guild = guildSuffix(dominantGuild(event.players));
      if (event.initial) {
        return {
          kind: "entered",
          title: `🐉 Raid already in ${areaName}`,
          body: `${count} ${plural(count, "player")} already inside${guild}.`,
        };
      }
      return {
        kind: "entered",
        title: `🐉 Raid entered ${areaName}`,
        body: `${count} ${plural(count, "player")} just appeared in ${areaName}${guild}. A kill — and a world buff — may be on the way.`,
      };
    }
    case "raid-left": {
      const count = event.previousPlayers.length;
      return {
        kind: "left",
        title: `✅ ${areaName} cleared`,
        body: `The raid has left ${areaName} (was ${count} ${plural(count, "player")}).`,
      };
    }
    case "roster-changed": {
      const count = event.players.length;
      const parts: string[] = [];
      if (event.entered.length > 0) parts.push(`+${event.entered.length}`);
      if (event.left.length > 0) parts.push(`-${event.left.length}`);
      return {
        kind: "changed",
        title: `👥 ${areaName}: ${count} inside`,
        body: `Roster changed (${parts.join(", ")}). ${count} ${plural(count, "player")} now in ${areaName}.`,
      };
    }
  }
}

function guildSuffix(guild: { guild: string; count: number } | null): string {
  return guild ? ` — mostly <${guild.guild}>` : "";
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
