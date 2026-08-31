import {
  ALL_ALERT_TYPES,
  DEFAULT_FACTIONS,
  isAlertType,
  isFaction,
  type AlertType,
  type Faction,
  type SubscriberStore,
} from "../subscribers/store.js";
import type { ActiveRaid } from "../watcher/raid-tracker.js";
import { CITY_FOR, FACTION_FILTER_HINT, humanClock } from "../notify/format.js";
import { parseIntent, type Intent } from "./intent.js";

/** Per-faction buff cooldown for the status query. */
export interface BuffCooldown {
  readonly faction: Faction;
  /** ms until the active buff wears off and a fresh one can drop, or null if one can drop now. */
  readonly activeMsLeft: number | null;
}

/** A reader-friendly name for a set of subscribed sides. */
export function factionLabel(factions: readonly Faction[]): string {
  const set = new Set(factions);
  if (set.has("alliance") && set.has("horde")) return "both Stormwind & Orgrimmar";
  if (set.has("alliance")) return "Stormwind (Alliance)";
  if (set.has("horde")) return "Orgrimmar (Horde)";
  return "no";
}

/**
 * Routes a whisper from a player to a command and produces the reply line(s) to
 * whisper back. Pure aside from the injected store; terse because a whisper
 * is length-limited and a chatty bot is a reported bot.
 *
 * Commands (case-insensitive, a leading !/./ tolerated):
 *   subscribe | sub | start        — opt in to in-game raid alerts
 *   unsubscribe | unsub | stop      — opt out
 *   alliance | horde | both         — which side's buff you want
 *   invite | join                   — guild-invite the caller
 *   feedback | suggest              — send a message to the team
 *   notify | status | profile | help
 */
export interface CommandDeps {
  readonly store: SubscriberStore;
  /** Raids in progress across all factions — for the status command. */
  readonly activeRaids: () => readonly ActiveRaid[];
  readonly areaName: string;
  /** Guild + community named in recruiting/intent replies. */
  readonly guildName: string;
  readonly community: string;
  /** Receives a player's "feedback"/"suggest" message (sender + text). Fire-and-forget:
   *  the caller persists it and posts it to the feedback channel. Undefined = no-op. */
  readonly onFeedback?: (from: string, text: string) => void;
  /** How long the raid in progress has been in the lair (form → now), or null if none — for status. */
  readonly raidElapsed?: () => number | null;
  /** The reference number of the raid in progress, or null if none — for status. */
  readonly raidNumber?: () => number | null;
  /** Per-faction buff cooldown for status — how long until a fresh Rallying Cry can drop. */
  readonly buffCooldowns?: () => Promise<readonly BuffCooldown[]>;
}

export class CommandRouter {
  readonly #deps: CommandDeps;
  // Guild invites can only be sent by the connected watcher, which registers this
  // when it reaches world and clears it on disconnect. Null = can't invite right now.
  #guildInvite: ((name: string) => void) | null = null;
  // The watcher registers a /who-based faction detector; fired (fire-and-forget) when a
  // new subscriber is added, to auto-set their side. Null = detection unavailable.
  #factionLookup: ((name: string) => void) | null = null;

  constructor(deps: CommandDeps) {
    this.#deps = deps;
  }

  /** The watcher offers/withdraws its guild-invite capability as it connects/drops. */
  setGuildInvite(fn: ((name: string) => void) | null): void {
    this.#guildInvite = fn;
  }

  /** The watcher offers/withdraws /who-based faction detection as it connects/drops. */
  setFactionLookup(fn: ((name: string) => void) | null): void {
    this.#factionLookup = fn;
  }

  async handle(sender: string, text: string): Promise<string[]> {
    const parts = text.trim().replace(/^[!./]+/, "").split(/\s+/);
    const command = (parts[0] ?? "").toLowerCase();
    const arg = parts[1] ?? "";
    const { store, activeRaids, areaName } = this.#deps;

    switch (command) {
      case "subscribe":
      case "sub":
      case "start": {
        const added = await store.add(sender);
        if (added) this.#factionLookup?.(sender); // auto-detect their side in the background
        return added
          ? [`You're subscribed! I'll whisper you in-game when a raid clears and the buff is about to drop.`, FACTION_FILTER_HINT]
          : [`You're already subscribed to ${areaName} alerts. Whisper "profile" for your settings, or "help" for what I can do.`];
      }
      case "unsubscribe":
      case "unsub":
      case "stop": {
        const removed = await store.remove(sender);
        return [
          removed
            ? `Unsubscribed - no more ${areaName} alerts. Whisper "subscribe" to opt back in.`
            : `You weren't subscribed. Whisper "subscribe" to start.`,
        ];
      }
      case "invite":
      case "join":
        return this.#invite(sender);
      case "feedback":
      case "suggest":
      case "suggestion":
        return this.#feedback(sender, parts.slice(1).join(" ").trim());
      case "alliance":
      case "horde":
      case "both":
        return this.#setFaction(sender, command);
      case "faction":
      case "side":
        return this.#setFaction(sender, arg);
      case "notify":
      case "alerts":
        return this.#notify(sender, arg, (parts[2] ?? "").toLowerCase());
      case "profile":
      case "me": {
        const sub = await store.get(sender);
        if (!sub) return [`You're not subscribed. Whisper "subscribe" to start.`];
        const alerts = sub.alerts.length ? sub.alerts.join(", ") : "none";
        return [
          `Subscribed - ${factionLabel(sub.factions)} buffs. Alerts: ${alerts}. ("alliance"/"horde"/"both" to change your side.)`,
        ];
      }
      case "status":
        return this.#status();
      case "help":
      case "commands":
      case "?":
        return [
          `I warn you before the Onyxia "Rallying Cry" world buff drops, so you can park in a capital and grab it. Whisper me:`,
          `subscribe - start getting in-game alerts (unsubscribe anytime to stop)`,
          `alliance / horde / both - which side's buff you want (I try to detect it; default both)`,
          `invite - join <${this.#deps.guildName}>, the guild that runs me (we're recruiting!)`,
          `feedback <message> - send a suggestion or bug report straight to the team`,
          `also: notify which alerts (e.g. "notify cleared off"), status (raids now), profile (your settings).`,
        ];
      default: {
        // Natural-language intent detection over the whole message.
        const intent = parseIntent(text);
        if (intent) return this.#handleIntent(intent, sender);
        return [`Sorry, I didn't get that. Whisper "help" for what I can do.`];
      }
    }
  }

  /** Live-state query: what's raiding the lair now (and how long they've been in), and how
   *  long until a fresh Rallying Cry can drop in each capital. */
  async #status(): Promise<string[]> {
    const { activeRaids, areaName, raidElapsed, raidNumber, buffCooldowns } = this.#deps;
    const raids = activeRaids();
    const elapsed = raidElapsed?.() ?? null;
    const number = raidNumber?.() ?? null;
    const lines: string[] = [];
    if (raids.length === 0 && number === null) {
      lines.push(`No raid in ${areaName} right now.`);
    } else {
      const id = number !== null ? `raid #${number}` : raids.map((raid) => raid.label).join(", ");
      lines.push(`${areaName} now: ${id}${elapsed !== null ? ` (in for ~${humanClock(elapsed)})` : ""}.`);
    }
    if (buffCooldowns) {
      const part = (await buffCooldowns())
        .map((cd) =>
          cd.activeMsLeft === null
            ? `${CITY_FOR[cd.faction]}: a fresh buff can drop now`
            : `${CITY_FOR[cd.faction]}: buff up, ~${humanClock(cd.activeMsLeft)} until the next can drop`,
        )
        .join(" | ");
      lines.push(`Rallying Cry - ${part}.`);
    }
    return lines;
  }

  /** Choose which side's buffs to get: "alliance", "horde", or "both". Empty shows current. */
  async #setFaction(sender: string, side: string): Promise<string[]> {
    const { store } = this.#deps;
    const sub = await store.get(sender);
    if (!sub) return [`You're not subscribed. Whisper "subscribe" first.`];

    const s = side.trim().toLowerCase();
    if (s === "") {
      return [
        `You get ${factionLabel(sub.factions)} buff alerts. Whisper "alliance", "horde", or "both" to change.`,
      ];
    }
    let factions: readonly Faction[] | null = null;
    if (s === "both" || s === "all") factions = DEFAULT_FACTIONS;
    else if (isFaction(s)) factions = [s];
    else if (["alli", "ally", "aly", "a"].includes(s)) factions = ["alliance"];
    else if (["h"].includes(s)) factions = ["horde"];
    if (!factions) {
      return [`Whisper "alliance", "horde", or "both". You're on ${factionLabel(sub.factions)}.`];
    }
    await store.update(sender, { factions: [...factions] });
    return [`Done - I'll alert you for ${factionLabel(factions)} buffs.`];
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
      return [`All alerts OFF - still subscribed, but I won't whisper you. "notify all" to undo.`];
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

  /** Capture a player's feedback/suggestion and hand it off (persisted + posted to the
   *  feedback channel by the caller). Empty text just shows how to use it. */
  #feedback(sender: string, text: string): string[] {
    if (text === "") {
      return [`Whisper "feedback <your message>" and I'll pass your suggestion to <${this.#deps.guildName}>.`];
    }
    if (!this.#deps.onFeedback) {
      return [`Feedback isn't set up on this bot right now - sorry about that!`];
    }
    this.#deps.onFeedback(sender, text);
    return [`Thanks for the feedback - I've passed it along to <${this.#deps.guildName}>. Much appreciated!`];
  }

  /** Send the caller a guild invite. Only works while the watcher is in world; if it
   *  is offline, or Bufftracker lacks invite rights in the guild, nothing is sent. */
  #invite(sender: string): string[] {
    const { guildName } = this.#deps;
    if (!this.#guildInvite) {
      return [`I can't send a guild invite right now - try again in a moment.`];
    }
    this.#guildInvite(sender);
    return [`Invite to <${guildName}> sent - accept the popup and you're in. Welcome aboard!`];
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
            `Whisper "invite" and I'll send you an invite right now - and "subscribe" for buff alerts.`,
        ];
      case "buff":
        return [
          `I call out Rallying Cry buff drops from ${areaName} raids. ` +
            `Whisper "subscribe" and I'll ping you when one's about to drop.`,
        ];
    }
  }
}
