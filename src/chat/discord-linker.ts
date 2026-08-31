import type { DiscordDmSender } from "../notify/discord-dm.js";
import type { PendingLinks } from "../subscribers/pending-links.js";
import type { SubscriberStore } from "../subscribers/store.js";

/**
 * Links a character to a Discord account: `startDmLink` mints a code with no id (the
 * character whispers "discord" in-game), and the id is learned and trusted when the
 * user DMs the bot that code on Discord (`confirmFromDm`). One code store, one flow —
 * the DM author's id is always verified, so there's nothing to prove in-game.
 */
export interface LinkerDeps {
  readonly store: SubscriberStore;
  readonly pending: PendingLinks;
  readonly dm: DiscordDmSender;
  readonly serverInviteUrl: string | null;
  readonly areaName: string;
}

function firstToken(text: string): string {
  return text.trim().split(/\s+/)[0] ?? "";
}

export class DiscordLinker {
  readonly #deps: LinkerDeps;

  constructor(deps: LinkerDeps) {
    this.#deps = deps;
  }

  get isConfigured(): boolean {
    return this.#deps.dm.isConfigured;
  }

  get serverInviteUrl(): string | null {
    return this.#deps.serverInviteUrl;
  }

  /** Flow A: mint a code the user will DM to the bot. */
  async startDmLink(character: string): Promise<string> {
    await this.#deps.store.add(character);
    return this.#deps.pending.create(character);
  }

  /** A DM arrived from `discordId`; if it's a live code, link it to that character. */
  async confirmFromDm(discordId: string, content: string): Promise<string | null> {
    const pending = this.#deps.pending.resolve(firstToken(content));
    if (!pending) return null;
    this.#deps.pending.remove(pending.code);
    await this.#deps.store.update(pending.character, { discordId });
    await this.#deps.dm.send(discordId, `Linked! You'll get ${this.#deps.areaName} raid alerts here.`);
    return pending.character;
  }

  async unlink(character: string): Promise<boolean> {
    return this.#deps.store.update(character, { discordId: null });
  }
}
