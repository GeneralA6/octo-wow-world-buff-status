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

/** The lines Bufftracker whispers to a player who first contacts a listener. */
export function introLines(config: OutreachConfig): string[] {
  return [
    `Hi! I'm Bufftracker, made by ${config.author} of <${config.guildName}> - I warn you before the Onyxia Rallying Cry world buff drops, so you can park in a capital and grab it. Whisper me "subscribe" and I'll ping you in-game when it's time.`,
    `Every drop also goes out in the ${config.community} Discord (with @Alliance/@Horde pings) - whisper "discord" for the link. <${config.guildName}> is recruiting for the ${config.community} community - whisper "invite" to join! "help" for more.`,
    `Bufftracker is free and always will be. If it's saved you a buff or two, gold tips are welcome - never expected! Please mail them to ${config.author}.`,
  ];
}

/**
 * Greets players who interact with the parked listener characters. The listeners detect
 * the contact; the watcher (Bufftracker) does the whispering — so the watcher registers
 * its outbound channel here when in world and clears it on disconnect.
 *
 * Each player is greeted at most once (persisted in the {@link GreetLedger}, so a nightly
 * redeploy doesn't re-greet a regular), and only once the watcher is available — if it's
 * offline the contact is NOT claimed, so their next contact retries.
 */
export class Outreach {
  #whisper: WhisperFn | null = null;
  #guildInvite: GuildInviteFn | null = null;
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

  /** A player contacted a listener — introduce Bufftracker (once), and invite if enabled. */
  async onListenerContact(playerName: string): Promise<void> {
    const whisper = this.#whisper;
    if (!whisper) {
      // Watcher not in world — don't claim the greeting, so we retry on their next contact.
      this.#logger.debug(`outreach: watcher offline, cannot greet ${playerName} yet`);
      return;
    }
    if (!(await this.#greeted.claim(playerName))) return; // already greeted
    this.#logger.info(`outreach: greeting ${playerName}`);
    for (const line of introLines(this.#config)) whisper(playerName, line);
    if (this.#config.guildInviteEnabled && this.#guildInvite) {
      this.#guildInvite(playerName);
      whisper(playerName, `And I've sent you an invite to <${this.#config.guildName}> - welcome aboard!`);
    }
  }
}
