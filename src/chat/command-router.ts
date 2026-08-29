import type { SubscriberStore } from "../subscribers/store.js";
import type { RaidTracker } from "../watcher/raid-tracker.js";

/**
 * Routes a whisper from a player to a command and produces the reply line(s) to
 * whisper back. Pure aside from the injected store; kept small and terse because a
 * whisper is length-limited and a chatty bot is a reported bot.
 *
 * Commands (case-insensitive, a leading !/./ is tolerated):
 *   subscribe | sub | start   — opt in to in-game raid alerts
 *   unsubscribe | unsub | stop — opt out
 *   status                     — the current raid state, right now
 *   help                       — the command list
 */
export interface CommandDeps {
  readonly store: SubscriberStore;
  readonly tracker: RaidTracker;
  readonly areaName: string;
}

export class CommandRouter {
  readonly #deps: CommandDeps;

  constructor(deps: CommandDeps) {
    this.#deps = deps;
  }

  async handle(sender: string, text: string): Promise<string[]> {
    const command = text.trim().toLowerCase().replace(/^[!./]+/, "").split(/\s+/)[0] ?? "";
    const { store, tracker, areaName } = this.#deps;

    switch (command) {
      case "subscribe":
      case "sub":
      case "start": {
        const added = await store.add(sender);
        return [
          added
            ? `Subscribed — I'll whisper you when a raid forms or clears in ${areaName}. Whisper "unsubscribe" to stop.`
            : `You're already subscribed to ${areaName} alerts.`,
        ];
      }
      case "unsubscribe":
      case "unsub":
      case "stop": {
        const removed = await store.remove(sender);
        return [
          removed
            ? `Unsubscribed — no more ${areaName} alerts. Whisper "subscribe" to opt back in.`
            : `You weren't subscribed. Whisper "subscribe" to start.`,
        ];
      }
      case "status": {
        const raids = tracker.activeRaids();
        if (raids.length === 0) return [`No raid in ${areaName} right now.`];
        const summary = raids.map((raid) => `${raid.label} ${raid.count}`).join(", ");
        return [`${areaName} now: ${summary}.`];
      }
      case "help":
      case "commands":
      case "?":
        return [
          `I watch ${areaName}. Commands: subscribe, unsubscribe, status. ` +
            `Subscribe and I'll whisper you when a raid forms or clears.`,
        ];
      default:
        return [`Unknown command. Whisper "help" for what I can do.`];
    }
  }
}
