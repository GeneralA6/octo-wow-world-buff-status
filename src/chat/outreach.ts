import type { Logger } from "../logger.js";

export interface OutreachConfig {
  readonly guildName: string;
  readonly community: string;
  readonly guildInviteEnabled: boolean;
}

export type WhisperFn = (target: string, message: string) => void;
export type GuildInviteFn = (target: string) => void;

/** The lines Bufftracker whispers to a player who first contacts a listener. */
export function introLines(config: OutreachConfig): string[] {
  return [
    `Hi! I'm Bufftracker — I warn you before the Onyxia "Rallying Cry" world buff drops, so you can park in a capital and grab it. Whisper me "subscribe" and I'll ping you in-game when it's time.`,
    `Want it even when you're offline? Whisper me "discord" to link Discord — I'll DM you so you never miss a buff. <${config.guildName}> is recruiting for the ${config.community} community — whisper "invite" to join! "help" for more.`,
  ];
}

/**
 * Greets players who interact with the parked listener characters. The listeners
 * detect the contact; the watcher (Bufftracker) does the whispering — so the watcher
 * registers its outbound channel here when in world and clears it on disconnect.
 * Each player is greeted at most once per run, and only once the watcher is available.
 */
export class Outreach {
  #whisper: WhisperFn | null = null;
  #guildInvite: GuildInviteFn | null = null;
  readonly #greeted = new Set<string>();
  readonly #config: OutreachConfig;
  readonly #logger: Logger;

  constructor(config: OutreachConfig, logger: Logger) {
    this.#config = config;
    this.#logger = logger;
  }

  /** The watcher offers its outbound capabilities (in world); pass nulls to withdraw. */
  setChannel(whisper: WhisperFn | null, guildInvite: GuildInviteFn | null): void {
    this.#whisper = whisper;
    this.#guildInvite = guildInvite;
  }

  hasGreeted(name: string): boolean {
    return this.#greeted.has(name.trim().toLowerCase());
  }

  /** A player contacted a listener — introduce Bufftracker (once), and invite if enabled. */
  onListenerContact(playerName: string): void {
    const key = playerName.trim().toLowerCase();
    if (!key || this.#greeted.has(key)) return;
    if (!this.#whisper) {
      // Watcher not in world — don't mark greeted, so we retry on their next contact.
      this.#logger.debug(`outreach: watcher offline, cannot greet ${playerName} yet`);
      return;
    }
    this.#greeted.add(key);
    this.#logger.info(`outreach: greeting ${playerName}`);
    for (const line of introLines(this.#config)) this.#whisper(playerName, line);
    if (this.#config.guildInviteEnabled && this.#guildInvite) {
      this.#guildInvite(playerName);
      this.#whisper(playerName, `And I've sent you an invite to <${this.#config.guildName}> — welcome aboard!`);
    }
  }
}
