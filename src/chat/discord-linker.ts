import type { DiscordDmSender } from "../notify/discord-dm.js";
import type { PendingLinks } from "../subscribers/pending-links.js";
import { type SubscriberStore, subscriberKey } from "../subscribers/store.js";

/**
 * Links a character to a Discord account, driving both flows off one code store:
 *   - Flow A: `startDmLink` mints a code with no id; the id is learned when the
 *     user DMs the bot the code (`confirmFromDm`).
 *   - Flow B: `startIdLink` mints a code tied to a pasted id and DMs the code; the
 *     user whispers it back in-game (`confirmFromWhisper`).
 * A DM-confirmed link always trusts the DM author's id (verified); a whisper-confirmed
 * link trusts the id the code was minted with, and only for the character who owns it.
 */
export interface LinkerDeps {
  readonly store: SubscriberStore;
  readonly pending: PendingLinks;
  readonly dm: DiscordDmSender;
  readonly serverInviteUrl: string | null;
  readonly areaName: string;
}

export type IdLinkResult = "sent" | "unreachable" | "not-configured" | "error";

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

  /** Flow B: mint a code and DM it to `discordId`. */
  async startIdLink(character: string, discordId: string): Promise<IdLinkResult> {
    if (!this.#deps.dm.isConfigured) return "not-configured";
    await this.#deps.store.add(character);
    const code = this.#deps.pending.create(character, discordId);
    const result = await this.#deps.dm.send(
      discordId,
      `Your ${this.#deps.areaName} link code is ${code}. Whisper it back to the bot in-game to confirm.`,
    );
    if (result.ok) return "sent";
    this.#deps.pending.remove(code); // couldn't reach them — don't leave a dangling code
    return result.kind === "unreachable" ? "unreachable" : result.kind === "not-configured" ? "not-configured" : "error";
  }

  /** Flow A confirm: a DM arrived from `discordId`; if it's a live code, link it. */
  async confirmFromDm(discordId: string, content: string): Promise<string | null> {
    const pending = this.#deps.pending.resolve(firstToken(content));
    if (!pending) return null;
    this.#deps.pending.remove(pending.code);
    await this.#deps.store.update(pending.character, { discordId });
    await this.#deps.dm.send(discordId, `Linked! You'll get ${this.#deps.areaName} raid alerts here.`);
    return pending.character;
  }

  /** Flow B confirm: `character` whispered a code back; link it to the minted id. */
  async confirmFromWhisper(character: string, content: string): Promise<boolean> {
    const pending = this.#deps.pending.resolve(firstToken(content));
    if (!pending || pending.character !== subscriberKey(character) || !pending.discordId) return false;
    this.#deps.pending.remove(pending.code);
    return this.#deps.store.update(character, { discordId: pending.discordId });
  }

  async unlink(character: string): Promise<boolean> {
    return this.#deps.store.update(character, { discordId: null });
  }
}
