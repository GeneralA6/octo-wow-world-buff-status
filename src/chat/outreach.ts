import type { Logger } from "../logger.js";
import type { Faction } from "../subscribers/store.js";
import type { IntroStore } from "./intro-store.js";

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

/** Bufftracker's one-time self-introduction to a player who first contacts a listener: who
 *  it is, who runs it (the guild, for the community), that the guild is recruiting, and how to
 *  opt in. Sent ONCE per player (see `IntroStore`) — not every message — so it can afford the
 *  attribution and recruiting that the terse command replies deliberately drop. No tips: those
 *  ride the buff-drop message. Two short whispers, each well under the client's line limit. */
export function introLines(config: OutreachConfig): string[] {
  return [
    `Hi! I'm the Onyxia world-buff tracker for the ${config.community} community, run by the <${config.guildName}> guild - I ping you in-game just before the Rallying Cry drops. Whisper "subscribe" for pings, or "help" for more.`,
    `<${config.guildName}> is recruiting, too - whisper "invite" any time and I'll send you a guild invite.`,
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
 * and it works, and a player is never left without a reply. The FIRST time a not-yet-subscribed
 * player reaches a listener, Bufftracker also introduces itself (identity + attribution +
 * recruiting) and, if guild invites are enabled, sends a guild invite — both once, tracked in
 * the `IntroStore`. Only acts while the watcher is available.
 */
export class Outreach {
  #whisper: WhisperFn | null = null;
  #guildInvite: GuildInviteFn | null = null;
  #handle: HandleFn | null = null;
  readonly #config: OutreachConfig;
  readonly #isSubscribed: IsSubscribedFn;
  readonly #introStore: IntroStore;
  readonly #logger: Logger;

  constructor(config: OutreachConfig, isSubscribed: IsSubscribedFn, introStore: IntroStore, logger: Logger) {
    this.#config = config;
    this.#isSubscribed = isSubscribed;
    this.#introStore = introStore;
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
    // Introduce Bufftracker the FIRST time a not-yet-subscribed player reaches us — once, not
    // every message (the intro carries attribution + recruiting, which is spam if repeated).
    // `introduceOnce` is atomic, so back-to-back whispers can't double-send.
    if (!(await this.#isSubscribed(playerName)) && (await this.#introStore.introduceOnce(playerName))) {
      this.#logger.info(`outreach: introducing Bufftracker to ${playerName}`);
      for (const line of introLines(this.#config)) whisper(playerName, line);
      // Invite silently — no "I sent you an invite" whisper. If they accept, they're welcomed in
      // guild chat instead (the join is detected server-side). Gated on the watcher being guilded.
      if (this.#config.guildInviteEnabled && this.#guildInvite) {
        this.#guildInvite(playerName);
      }
    }
    // Every message is transferred to Bufftracker's command engine and answered.
    if (this.#handle) {
      for (const reply of await this.#handle(playerName, text, sourceFaction)) whisper(playerName, reply);
    }
  }
}
