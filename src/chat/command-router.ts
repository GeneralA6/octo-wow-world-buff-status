import {
  ALL_ALERT_TYPES,
  isAlertType,
  type AlertType,
  type DeliveryMode,
  type SubscriberStore,
} from "../subscribers/store.js";
import type { ActiveRaid } from "../watcher/raid-tracker.js";
import type { DiscordLinker } from "./discord-linker.js";
import { parseIntent, type Intent } from "./intent.js";

/**
 * Routes a whisper from a player to a command and produces the reply line(s) to
 * whisper back. Pure aside from the injected store/linker; terse because a whisper
 * is length-limited and a chatty bot is a reported bot.
 *
 * Commands (case-insensitive, a leading !/./ tolerated):
 *   subscribe | sub | start        — opt in to in-game raid alerts
 *   unsubscribe | unsub | stop      — opt out
 *   discord                         — link Discord by DMing the bot a code (flow A)
 *   discord <id>                    — link by pasting your id; bot DMs a code (flow B)
 *   discord off                     — unlink
 *   confirm <code> | <code>         — confirm a flow-B code in-game
 *   mode both | mode offline        — Discord always, or only when offline in-game
 *   status | me | help
 */
export interface CommandDeps {
  readonly store: SubscriberStore;
  /** Raids in progress across all factions — for the status command. */
  readonly activeRaids: () => readonly ActiveRaid[];
  readonly areaName: string;
  /** Guild + community named in recruiting/intent replies. */
  readonly guildName: string;
  readonly community: string;
  /** Null when no bot token is configured — the discord commands then say so. */
  readonly linker?: DiscordLinker | null;
}

const DISCORD_ID = /^\d{17,20}$/;
const MODE_ALIASES: Record<string, DeliveryMode> = {
  ingame: "ingame",
  "in-game": "ingame",
  whisper: "ingame",
  both: "both",
  all: "both",
  offline: "offline",
  "offline-only": "offline",
  discord: "discord",
  dm: "discord",
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
    const { store, activeRaids, areaName, linker } = this.#deps;

    switch (command) {
      case "subscribe":
      case "sub":
      case "start": {
        const added = await store.add(sender);
        return [
          added
            ? `Subscribed — I'll whisper you when a raid forms or clears in ${areaName}. Whisper "discord" to also get Discord DMs. "help" for more.`
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
      case "confirm": {
        if (!linker) return ["Discord isn't set up on this bot."];
        const ok = await linker.confirmFromWhisper(sender, arg);
        return [ok ? this.#linkedLine() : `That code didn't match. Whisper "discord" to start again.`];
      }
      case "mode":
        return this.#mode(sender, arg);
      case "notify":
      case "alerts":
        return this.#notify(sender, arg, (parts[2] ?? "").toLowerCase());
      case "me": {
        const sub = await store.get(sender);
        if (!sub) return [`You're not subscribed. Whisper "subscribe" to start.`];
        const discord = sub.discordId
          ? `Discord linked, delivery "${sub.delivery}"`
          : `no Discord linked`;
        const alerts = sub.alerts.length ? sub.alerts.join(", ") : "none";
        return [`Subscribed to ${areaName} alerts — ${discord}. Alerts: ${alerts}.`];
      }
      case "status": {
        const raids = activeRaids();
        if (raids.length === 0) return [`No raid in ${areaName} right now.`];
        return [`${areaName} now: ${raids.map((raid) => `${raid.label} ${raid.count}`).join(", ")}.`];
      }
      case "help":
      case "commands":
      case "?":
        return [
          `I watch ${areaName}. Commands: subscribe, unsubscribe, discord [<id>], ` +
            `mode ingame|both|offline|discord, notify <type> on|off, status, me. ` +
            `Alert types: ${ALL_ALERT_TYPES.join(", ")}.`,
        ];
      default: {
        // A bare confirmation code from a flow-B link.
        if (linker && (await linker.confirmFromWhisper(sender, command))) return [this.#linkedLine()];
        // Fall back to natural-language intent detection over the whole message.
        const intent = parseIntent(text);
        if (intent) return this.#handleIntent(intent, sender);
        return [`Sorry, I didn't get that. Whisper "help" for what I can do.`];
      }
    }
  }

  #linkedLine(): string {
    return `Discord linked! You'll get ${this.#deps.areaName} alerts there too. "mode offline" for DMs only when you're offline.`;
  }

  async #discord(sender: string, arg: string): Promise<string[]> {
    const { linker } = this.#deps;
    if (!linker) return ["Discord isn't set up on this bot."];
    const invite = linker.serverInviteUrl;
    const joinHint = invite ? ` Join ${invite} first.` : "";

    if (arg === "") {
      const code = await linker.startDmLink(sender);
      return [`To link Discord:${joinHint} then DM the bot the code ${code} (expires ~15 min).`];
    }
    if (["off", "clear", "none", "remove"].includes(arg.toLowerCase())) {
      const ok = await linker.unlink(sender);
      return [ok ? `Discord unlinked — in-game whispers only.` : `You're not subscribed.`];
    }
    if (!DISCORD_ID.test(arg)) {
      return [`That isn't a Discord id. Whisper just "discord" to link by DMing me a code instead.`];
    }
    switch (await linker.startIdLink(sender, arg)) {
      case "sent":
        return [`I DMed you a code — whisper it back here to confirm.`];
      case "unreachable":
        return [`I couldn't DM you.${joinHint} Enable "DMs from server members", then try again.`];
      case "not-configured":
        return [`Discord isn't set up on this bot.`];
      default:
        return [`Trouble reaching Discord — try again in a moment.`];
    }
  }

  async #mode(sender: string, arg: string): Promise<string[]> {
    const { store } = this.#deps;
    const delivery = MODE_ALIASES[arg.toLowerCase()];
    if (!delivery) {
      return [
        `Whisper "mode ingame" (whispers only), "mode both" (whispers + Discord), ` +
          `"mode offline" (Discord only when you're offline), or "mode discord" (Discord DMs only).`,
      ];
    }
    const sub = await store.get(sender);
    if (!sub) return [`You're not subscribed. Whisper "subscribe" first.`];
    await store.update(sender, { delivery });

    // The Discord modes are useless without a linked id — "discord" would reach nobody.
    if (delivery !== "ingame" && !sub.discordId) {
      return [
        delivery === "discord"
          ? `Set to "discord", but you have NO Discord linked — you'll get nothing until you whisper "discord" to link it.`
          : `Set to "${delivery}", but link Discord with "discord" so I can reach you there.`,
      ];
    }
    const CONFIRM: Record<DeliveryMode, string> = {
      ingame: `Delivery set to "ingame" — in-game whispers only.`,
      both: `Delivery set to "both" — in-game and Discord.`,
      offline: `Delivery set to "offline" — Discord only when your character is offline.`,
      discord: `Delivery set to "discord" — Discord DMs only, no in-game whispers.`,
    };
    return [CONFIRM[delivery]];
  }

  /** Choose which alert types you get. "notify" shows them; "notify <type> on|off",
   *  "notify all", "notify none". A bare "notify <type>" flips it. */
  async #notify(sender: string, target: string, onOff: string): Promise<string[]> {
    const { store } = this.#deps;
    const sub = await store.get(sender);
    if (!sub) return [`You're not subscribed. Whisper "subscribe" first.`];

    const listing = sub.alerts.length ? sub.alerts.join(", ") : "none";
    const t = target.toLowerCase();

    if (t === "") {
      return [
        `You get: ${listing} (of: ${ALL_ALERT_TYPES.join(", ")}). ` +
          `Change with "notify <type> on|off", "notify all", or "notify none".`,
      ];
    }
    if (t === "all") {
      await store.update(sender, { alerts: [...ALL_ALERT_TYPES] });
      return [`All alerts ON: ${ALL_ALERT_TYPES.join(", ")}.`];
    }
    if (t === "none") {
      await store.update(sender, { alerts: [] });
      return [`All alerts OFF — still subscribed, but I won't whisper you. "notify all" to undo.`];
    }
    if (!isAlertType(t)) {
      return [`Unknown alert "${target}". Types: ${ALL_ALERT_TYPES.join(", ")}. Try "notify ${ALL_ALERT_TYPES[0]} off".`];
    }

    const has = sub.alerts.includes(t);
    const wantOn = onOff === "" ? !has : onOff !== "off" && onOff !== "0" && onOff !== "no";
    const set = new Set<AlertType>(sub.alerts);
    if (wantOn) set.add(t);
    else set.delete(t);
    const alerts = ALL_ALERT_TYPES.filter((type) => set.has(type));
    await store.update(sender, { alerts });
    return [`"${t}" ${wantOn ? "ON" : "OFF"}. You now get: ${alerts.length ? alerts.join(", ") : "nothing"}.`];
  }

  /** Act on a natural-language intent — re-dispatching to the canonical command where one exists. */
  async #handleIntent(intent: Intent, sender: string): Promise<string[]> {
    const { areaName, guildName, community } = this.#deps;
    switch (intent) {
      case "subscribe":
      case "unsubscribe":
      case "status":
      case "help":
        return this.handle(sender, intent);
      case "guild":
        return [
          `We're <${guildName}>, a ${community} community guild, and we're recruiting! ` +
            `Whisper "subscribe" for buff alerts — an officer will get you an invite.`,
        ];
      case "buff":
        return [
          `I call out Rallying Cry buff drops from ${areaName} raids. ` +
            `Whisper "subscribe" and I'll ping you when one's about to drop.`,
        ];
    }
  }
}
