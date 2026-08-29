/**
 * Notification sink abstraction and a Discord-webhook implementation.
 *
 * The rest of the bot depends only on `Notifier`, so Telegram/ntfy/etc. can be
 * added as siblings without touching the watcher or the main loop. The Discord
 * sender takes an injectable HTTP post so it can be tested without a network.
 */

export type NotifyKind = "entered" | "left" | "changed" | "info" | "error";

export interface NotifyMessage {
  readonly kind: NotifyKind;
  readonly title: string;
  readonly body: string;
  /** Discord user ids to ping personally in the post (registered subscribers). */
  readonly mentionUserIds?: readonly string[];
}

export interface Notifier {
  notify(message: NotifyMessage): Promise<void>;
}

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** Minimal POST-JSON function; the default wraps global fetch. */
export type HttpPostJson = (url: string, jsonBody: string) => Promise<HttpResponse>;

const defaultPost: HttpPostJson = (url, jsonBody) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonBody,
  });

/** Discord embed colours per event kind (decimal ints, as Discord expects). */
const EMBED_COLOR: Record<NotifyKind, number> = {
  entered: 0xe67e22,
  left: 0x2ecc71,
  changed: 0x3498db,
  info: 0x95a5a6,
  error: 0xe74c3c,
};

/** Event kinds worth pinging the opt-in role for — the actionable ones. */
const MENTION_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>(["entered", "left"]);

interface DiscordPayload {
  embeds: { title: string; description: string; color: number }[];
  content?: string;
  allowed_mentions?: { parse: string[]; roles: string[]; users: string[] };
}

export interface DiscordWebhookOptions {
  /** When set, raid enter/leave posts ping this role so only opted-in members are notified. */
  readonly mentionRoleId?: string | null;
  /** Injectable HTTP post for testing. */
  readonly post?: HttpPostJson;
}

export class DiscordWebhookNotifier implements Notifier {
  readonly #webhookUrl: string;
  readonly #post: HttpPostJson;
  readonly #mentionRoleId: string | null;

  constructor(webhookUrl: string, options: DiscordWebhookOptions = {}) {
    if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(webhookUrl)) {
      throw new Error("DISCORD_WEBHOOK_URL must be a discord.com webhook URL");
    }
    this.#webhookUrl = webhookUrl;
    this.#post = options.post ?? defaultPost;
    this.#mentionRoleId = options.mentionRoleId ?? null;
  }

  async notify(message: NotifyMessage): Promise<void> {
    const payload: DiscordPayload = {
      embeds: [
        {
          title: message.title,
          description: message.body,
          color: EMBED_COLOR[message.kind],
        },
      ],
    };

    // A mention only pings from message content, and allowed_mentions must permit it.
    const roleId = this.#mentionRoleId;
    const roleMention = roleId && MENTION_KINDS.has(message.kind) ? roleId : null;
    const userIds = message.mentionUserIds ?? [];
    const content: string[] = [];
    if (roleMention) content.push(`<@&${roleMention}>`);
    for (const id of userIds) content.push(`<@${id}>`);
    if (content.length > 0) {
      payload.content = content.join(" ");
      payload.allowed_mentions = {
        parse: [],
        roles: roleMention ? [roleMention] : [],
        users: [...userIds],
      };
    }

    const response = await this.#post(this.#webhookUrl, JSON.stringify(payload));
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Discord webhook failed with ${response.status}: ${detail}`.trim());
    }
  }
}
