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

export class DiscordWebhookNotifier implements Notifier {
  readonly #webhookUrl: string;
  readonly #post: HttpPostJson;

  constructor(webhookUrl: string, post: HttpPostJson = defaultPost) {
    if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(webhookUrl)) {
      throw new Error("DISCORD_WEBHOOK_URL must be a discord.com webhook URL");
    }
    this.#webhookUrl = webhookUrl;
    this.#post = post;
  }

  async notify(message: NotifyMessage): Promise<void> {
    const payload = JSON.stringify({
      embeds: [
        {
          title: message.title,
          description: message.body,
          color: EMBED_COLOR[message.kind],
        },
      ],
    });

    const response = await this.#post(this.#webhookUrl, payload);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Discord webhook failed with ${response.status}: ${detail}`.trim());
    }
  }
}
