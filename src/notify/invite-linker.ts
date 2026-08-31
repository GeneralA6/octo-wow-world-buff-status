import { silentLogger, type Logger } from "../logger.js";
import type { SubscriberStore } from "../subscribers/store.js";
import type { DiscordDmSender } from "./discord-dm.js";
import type { InvitesApi } from "./discord-invites.js";
import { InviteLinks, useCounts, whichInviteUsed } from "./invite-tracker.js";

/**
 * Drives personal-invite linking end to end:
 *   - `mintFor(character)` creates a single-use invite and remembers code→character;
 *     the caller whispers that url to the player in-game.
 *   - `refresh()` snapshots the guild's invite use-counts (called once the gateway is
 *     ready), so the first join has a baseline to diff against.
 *   - `onMemberJoin(discordId)` re-reads the invites, works out which one was consumed,
 *     maps it to the character, and links the two — automatically and verified.
 *
 * Everything degrades to a no-op when unconfigured (no token / guild / channel) or when
 * a REST call fails (missing permissions), so a half-set-up bot never throws.
 */
export interface InviteLinkerDeps {
  readonly invites: InvitesApi;
  readonly store: SubscriberStore;
  readonly dm: Pick<DiscordDmSender, "send">;
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly areaName: string;
  readonly logger?: Logger;
}

export class InviteLinker {
  readonly #deps: InviteLinkerDeps;
  readonly #logger: Logger;
  readonly #links = new InviteLinks();
  #cache = new Map<string, number>();

  constructor(deps: InviteLinkerDeps) {
    this.#deps = deps;
    this.#logger = deps.logger ?? silentLogger;
  }

  get isConfigured(): boolean {
    return this.#deps.invites.isConfigured && this.#deps.guildId !== null && this.#deps.channelId !== null;
  }

  /** Snapshot current invite use-counts as the diff baseline. Returns false if it can't
   *  read them (missing MANAGE_GUILD / intent), which is the signal the feature is off. */
  async refresh(): Promise<boolean> {
    if (!this.#deps.guildId) return false;
    const list = await this.#deps.invites.listInvites(this.#deps.guildId);
    if (!list) return false;
    this.#cache = useCounts(list);
    return true;
  }

  /** Mint a personal invite for `character`; the whisper-able url, or null if it can't. */
  async mintFor(character: string): Promise<string | null> {
    if (!this.#deps.channelId) return null;
    const invite = await this.#deps.invites.createInvite(this.#deps.channelId);
    if (!invite) return null;
    await this.#deps.store.add(character);
    this.#links.set(invite.code, character);
    this.#cache.set(invite.code, 0); // brand-new invite, unused so far
    return invite.url;
  }

  /** A member joined: find which personal invite they used and link them to its character. */
  async onMemberJoin(discordUserId: string): Promise<void> {
    if (!this.#deps.guildId) return;
    const list = await this.#deps.invites.listInvites(this.#deps.guildId);
    if (!list) return;
    const code = whichInviteUsed(this.#cache, list);
    this.#cache = useCounts(list);
    if (!code) {
      this.#logger.debug(`invite-link: join by ${discordUserId} — couldn't single out an invite`);
      return;
    }
    const character = this.#links.take(code);
    if (!character) return; // a real join, but not via one of our personal invites
    await this.#deps.store.update(character, { discordId: discordUserId });
    this.#logger.info(`invite-link: linked ${character} to discord ${discordUserId} via ${code}`);
    await this.#deps.dm.send(
      discordUserId,
      `Linked! You'll get ${this.#deps.areaName} raid alerts here. "mode offline" to only be DM'd when you're logged out.`,
    );
  }
}
