import type { Logger } from "../logger.js";
import type { GreetLedger } from "./greet-ledger.js";

export interface OutreachConfig {
  readonly guildName: string;
  readonly community: string;
  readonly guildInviteEnabled: boolean;
  /** Who made the bot — credited in the intro and named for optional gold tips. */
  readonly author: string;
}

export type WhisperFn = (target: string, message: string) => void;
export type GuildInviteFn = (target: string) => void;
/** Runs a player's message through the command engine and returns the reply line(s). */
export type HandleFn = (sender: string, text: string) => Promise<string[]>;

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
 * and it works, and a player is never left without a reply. On a player's FIRST contact it also
 * sends the onboarding intro (once — persisted in the {@link GreetLedger}, so a nightly redeploy
 * doesn't re-introduce itself to a regular). Only acts while the watcher is available; if it's
 * offline the contact is NOT claimed, so their next contact retries.
 */
export class Outreach {
  #whisper: WhisperFn | null = null;
  #guildInvite: GuildInviteFn | null = null;
  #handle: HandleFn | null = null;
  readonly #config: OutreachConfig;
  readonly #greeted: GreetLedger;
  readonly #logger: Logger;

  constructor(config: OutreachConfig, greeted: GreetLedger, logger: Logger) {
    this.#config = config;
    this.#greeted = greeted;
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

  /** A player whispered a listener — introduce Bufftracker on their first contact, then route
   *  their message (every time) through Bufftracker's command engine and whisper back the reply. */
  async onListenerContact(playerName: string, text: string): Promise<void> {
    const whisper = this.#whisper;
    if (!whisper) {
      // Watcher not in world — don't claim the greeting, so we retry on their next contact.
      this.#logger.debug(`outreach: watcher offline, cannot answer ${playerName} yet`);
      return;
    }
    // First contact → the onboarding intro (and a guild invite when that's enabled).
    if (await this.#greeted.claim(playerName)) {
      this.#logger.info(`outreach: greeting ${playerName}`);
      for (const line of introLines(this.#config)) whisper(playerName, line);
      if (this.#config.guildInviteEnabled && this.#guildInvite) {
        this.#guildInvite(playerName);
        whisper(playerName, `And I've sent you an invite to <${this.#config.guildName}> - welcome aboard!`);
      }
    }
    // Every message is transferred to Bufftracker's command engine and answered.
    if (this.#handle) {
      for (const reply of await this.#handle(playerName, text)) whisper(playerName, reply);
    }
  }
}
