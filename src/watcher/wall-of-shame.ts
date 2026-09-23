import type { Logger } from "../logger.js";
import {
  DISCORD_MESSAGE_LIMIT,
  type ChannelMessage,
  type CreateResult,
  type DmResult,
} from "../notify/discord-dm.js";
import type { WallOfShameStore } from "./wall-of-shame-store.js";

/**
 * The wall of shame: ONE pinned message showing the shame list (see shame-list.ts) — every player
 * who has killed a bot listener, a "- Name" line each, in the order they first did it.
 *
 * Edited in place, never reposted, for the reason the other boards are: the message id is kept, so
 * a redeploy edits the same message instead of orphaning it and pinning a second. A message someone
 * deleted is posted and pinned afresh; one merely unpinned is left alone.
 *
 * Discord refuses a message over its length limit, so a wall too long for one message shows the
 * players who fit — the earliest — and says so in the log. That is over a hundred names.
 */

/** The three channel operations the wall needs. */
export interface WallChannel {
  create(message: ChannelMessage): Promise<CreateResult>;
  edit(messageId: string, message: ChannelMessage): Promise<DmResult>;
  pin(messageId: string): Promise<DmResult>;
}

export interface WallOfShameDeps {
  readonly channel: WallChannel;
  readonly store: WallOfShameStore;
  readonly logger: Logger;
}

/** The wall's text, one "- Name" line per player, holding as many as fit in `maxLength`. */
export function renderWall(
  names: readonly string[],
  maxLength: number = DISCORD_MESSAGE_LIMIT,
): { readonly content: string; readonly shown: number } {
  const lines: string[] = [];
  let length = 0;
  for (const name of names) {
    const line = `- ${name}`;
    const added = (lines.length > 0 ? 1 : 0) + line.length;
    if (length + added > maxLength) break;
    lines.push(line);
    length += added;
  }
  return { content: lines.join("\n"), shown: lines.length };
}

function describe(result: DmResult | CreateResult): string {
  return result.ok ? "ok" : `${result.kind}${result.status ? ` ${result.status}` : ""}`;
}

export class WallOfShame {
  readonly #deps: WallOfShameDeps;
  #messageId: string | null = null;
  /** The message this session posted but could not pin — tried again on the next change. */
  #unpinned: string | null = null;
  /** Serialises paints, so two deaths at once cannot race into two posted walls. */
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: WallOfShameDeps) {
    this.#deps = deps;
  }

  /** Load the message id. Call once on boot, before the first paint. */
  async load(): Promise<void> {
    const state = await this.#deps.store.load();
    this.#messageId = state?.messageId ?? null;
  }

  /**
   * Show these players on the wall — after one is added, and on boot, so a message deleted while
   * the bot was down comes back.
   */
  show(names: readonly string[]): Promise<void> {
    this.#queue = this.#queue.then(() => this.#render(names)).catch((error) =>
      this.#deps.logger.error(`wall of shame threw: ${error instanceof Error ? error.message : String(error)}`),
    );
    return this.#queue;
  }

  async #render(names: readonly string[]): Promise<void> {
    // Nobody to name yet, and Discord refuses an empty message: the wall goes up with its first name.
    if (names.length === 0) return;
    const { content, shown } = renderWall(names);
    if (shown < names.length) {
      this.#deps.logger.warn(`wall of shame: ${names.length - shown} players do not fit in one message`);
    }
    const message: ChannelMessage = { content };

    if (this.#messageId !== null) {
      const edited = await this.#deps.channel.edit(this.#messageId, message);
      if (edited.ok) {
        if (this.#unpinned === this.#messageId) await this.#pin(this.#messageId);
        return;
      }
      if (edited.kind !== "unreachable" || edited.status !== 404) {
        this.#deps.logger.error(`wall of shame edit failed (${describe(edited)})`);
        return;
      }
      this.#deps.logger.warn("wall of shame message is gone; posting it again");
      this.#messageId = null;
    }

    const created = await this.#deps.channel.create(message);
    if (!created.ok) {
      this.#deps.logger.error(`wall of shame post failed (${describe(created)})`);
      return;
    }
    this.#messageId = created.messageId;
    await this.#deps.store.save({ messageId: created.messageId });
    await this.#pin(created.messageId);
  }

  async #pin(messageId: string): Promise<void> {
    const pinned = await this.#deps.channel.pin(messageId);
    if (pinned.ok) {
      this.#unpinned = null;
      return;
    }
    this.#unpinned = messageId;
    this.#deps.logger.error(
      `wall of shame pin failed (${describe(pinned)}) — the bot needs the Pin Messages permission in its channel`,
    );
  }
}
