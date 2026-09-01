import type { Logger } from "../logger.js";
import type { Faction } from "../subscribers/store.js";

export interface OutreachConfig {
  readonly guildName: string;
  readonly community: string;
  readonly guildInviteEnabled: boolean;
  /** Who made the bot — credited in the intro and named for optional gold tips. */
  readonly author: string;
}

export type WhisperFn = (target: string, message: string) => void;
export type GuildInviteFn = (target: string) => void;
/** Runs a player's message through the command engine and returns the reply line(s).
 *  `sourceFaction` is the player's side when they reached us through a faction-specific listener —
 *  safe to assume it's theirs (that listener serves one faction's capital), so the engine can skip
 *  the /who. */
export type HandleFn = (sender: string, text: string, sourceFaction: Faction | null) => Promise<string[]>;
/** Whether a player is already a subscriber — subscribers are onboarded, so they skip the intro. */
export type IsSubscribedFn = (name: string) => Promise<boolean>;

/** The lines Bufftracker whispers to a player who first contacts a listener. Concise: what
 *  it does and how to opt in — no attribution, no recruiting, no tips (those ride the buff-drop
 *  message now). */
export function introLines(config: OutreachConfig): string[] {
  return [
    `I'm the ${config.community}-Community World Buff Tracker - I alert you before the Onyxia Rallying Cry world buff drops. Whisper "subscribe" and I'll ping you in-game when it's coming, or "help" for more.`,
  ];
}

/**
 * Bridges a player's contact with a parked listener character to Bufftracker: the listeners
 * hear the whisper, but Bufftracker does the thinking and the whispering — so the watcher
 * registers its outbound channel AND its command engine here when in world, and clears them
 * on disconnect.
 *
 * Every listener whisper is routed to Bufftracker's command engine and answered, so a listener
 * is a full front-end for Bufftracker — you can whisper "subscribe" or "help" at onyxiabuffsw
 * and it works, and a player is never left without a reply. It also sends the onboarding intro to
 * any player who ISN'T subscribed yet — every time, so it keeps nudging them to join — and stops
 * once they subscribe (they're onboarded). Only acts while the watcher is available.
 */
export class Outreach {
  #whisper: WhisperFn | null = null;
  #guildInvite: GuildInviteFn | null = null;
  #handle: HandleFn | null = null;
  readonly #config: OutreachConfig;
  readonly #isSubscribed: IsSubscribedFn;
  readonly #logger: Logger;

  constructor(config: OutreachConfig, isSubscribed: IsSubscribedFn, logger: Logger) {
    this.#config = config;
    this.#isSubscribed = isSubscribed;
    this.#logger = logger;
  }

  /** The watcher offers its outbound capabilities (in world); pass nulls to withdraw. */
  setChannel(whisper: WhisperFn | null, guildInvite: GuildInviteFn | null): void {
    this.#whisper = whisper;
    this.#guildInvite = guildInvite;
  }

  /** The command engine listener whispers are routed through. Set once at startup. */
  setHandler(handle: HandleFn | null): void {
    this.#handle = handle;
  }

  /** A player whispered a listener — introduce Bufftracker unless they're already subscribed,
   *  then route their message through Bufftracker's command engine and whisper back the reply.
   *  `sourceFaction` is the listener's side (the player's, safe to assume), passed to the engine
   *  so it can set/tailor the side without a /who; null for a faction-less listener. */
  async onListenerContact(playerName: string, text: string, sourceFaction: Faction | null = null): Promise<void> {
    const whisper = this.#whisper;
    if (!whisper) {
      // Watcher not in world — can't reply; their next contact will be handled.
      this.#logger.debug(`outreach: watcher offline, cannot answer ${playerName} yet`);
      return;
    }
    // Introduce the bot to anyone not subscribed yet — every contact, until they join.
    if (!(await this.#isSubscribed(playerName))) {
      this.#logger.info(`outreach: greeting ${playerName}`);
      for (const line of introLines(this.#config)) whisper(playerName, line);
      if (this.#config.guildInviteEnabled && this.#guildInvite) {
        this.#guildInvite(playerName);
        whisper(playerName, `And I've sent you a guild invite - accept the popup to join!`);
      }
    }
    // Every message is transferred to Bufftracker's command engine and answered.
    if (this.#handle) {
      for (const reply of await this.#handle(playerName, text, sourceFaction)) whisper(playerName, reply);
    }
  }
}
