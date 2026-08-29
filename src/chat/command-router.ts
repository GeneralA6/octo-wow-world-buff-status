import type { DeliveryMode, SubscriberStore } from "../subscribers/store.js";
import type { RaidTracker } from "../watcher/raid-tracker.js";

/**
 * Routes a whisper from a player to a command and produces the reply line(s) to
 * whisper back. Pure aside from the injected store; kept terse because a whisper is
 * length-limited and a chatty bot is a reported bot.
 *
 * Commands (case-insensitive, a leading !/./ tolerated):
 *   subscribe | sub | start        — opt in to in-game raid alerts
 *   unsubscribe | unsub | stop      — opt out
 *   discord <id> | discord off      — link / unlink a Discord user id
 *   mode both | mode offline        — Discord always, or only when offline in-game
 *   status                          — the current raid state
 *   me                              — your own subscription settings
 *   help                            — the command list
 */
export interface CommandDeps {
  readonly store: SubscriberStore;
  readonly tracker: RaidTracker;
  readonly areaName: string;
}

const DISCORD_ID = /^\d{17,20}$/;
const MODE_ALIASES: Record<string, DeliveryMode> = {
  both: "both",
  all: "both",
  offline: "offline",
  "offline-only": "offline",
};

export class CommandRouter {
  readonly #deps: CommandDeps;

  constructor(deps: CommandDeps) {
    this.#deps = deps;
  }

  async handle(sender: string, text: string): Promise<string[]> {
    const parts = text.trim().replace(/^[!./]+/, "").split(/\s+/);
    const command = (parts[0] ?? "").toLowerCase();
    const arg = parts[1] ?? "";
    const { store, tracker, areaName } = this.#deps;

    switch (command) {
      case "subscribe":
      case "sub":
      case "start": {
        const added = await store.add(sender);
        return [
          added
            ? `Subscribed — I'll whisper you when a raid forms or clears in ${areaName}. Link Discord with "discord <id>" for pings there too. "help" for more.`
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
      case "discord":
        return this.#discord(sender, arg);
      case "mode":
        return this.#mode(sender, arg);
      case "me": {
        const sub = await store.get(sender);
        if (!sub) return [`You're not subscribed. Whisper "subscribe" to start.`];
        const discord = sub.discordId
          ? `Discord linked, delivery "${sub.delivery}"`
          : `no Discord linked`;
        return [`Subscribed to ${areaName} alerts — ${discord}.`];
      }
      case "status": {
        const raids = tracker.activeRaids();
        if (raids.length === 0) return [`No raid in ${areaName} right now.`];
        return [`${areaName} now: ${raids.map((raid) => `${raid.label} ${raid.count}`).join(", ")}.`];
      }
      case "help":
      case "commands":
      case "?":
        return [
          `I watch ${areaName}. Commands: subscribe, unsubscribe, discord <id>, ` +
            `mode both|offline, status, me. Subscribe for in-game alerts; link Discord to be pinged there.`,
        ];
      default:
        return [`Unknown command. Whisper "help" for what I can do.`];
    }
  }

  async #discord(sender: string, arg: string): Promise<string[]> {
    const { store } = this.#deps;
    if (arg === "") {
      return [
        `Whisper "discord <your id>" to link Discord, or "discord off" to unlink. ` +
          `In Discord: Developer Mode on, right-click yourself, Copy User ID.`,
      ];
    }
    if (["off", "clear", "none", "remove"].includes(arg.toLowerCase())) {
      const ok = await store.update(sender, { discordId: null });
      return [ok ? `Discord unlinked — in-game whispers only.` : `You're not subscribed. Whisper "subscribe" first.`];
    }
    if (!DISCORD_ID.test(arg)) {
      return [
        `That isn't a Discord user id (17-20 digits). In Discord: Developer Mode on, ` +
          `right-click yourself, Copy User ID.`,
      ];
    }
    await store.add(sender); // linking implies wanting alerts; make sure they exist
    await store.update(sender, { discordId: arg });
    return [
      `Discord linked — raid alerts in-game and on Discord (mode "both"). ` +
        `Whisper "mode offline" for Discord only when you're offline in-game.`,
    ];
  }

  async #mode(sender: string, arg: string): Promise<string[]> {
    const { store } = this.#deps;
    const delivery = MODE_ALIASES[arg.toLowerCase()];
    if (!delivery) {
      return [`Whisper "mode both" (in-game + Discord) or "mode offline" (Discord only when you're offline).`];
    }
    const sub = await store.get(sender);
    if (!sub) return [`You're not subscribed. Whisper "subscribe" first.`];
    await store.update(sender, { delivery });
    if (delivery === "offline" && !sub.discordId) {
      return [`Delivery set to "offline" — but link Discord with "discord <id>" so I can reach you when you're offline.`];
    }
    return [
      delivery === "both"
        ? `Delivery set to "both" — in-game and Discord.`
        : `Delivery set to "offline" — Discord only when your character is offline.`,
    ];
  }
}
