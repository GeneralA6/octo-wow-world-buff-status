/**
 * Sends a Discord DM to a user via the Bot API — the two-step flow:
 *   1. POST /users/@me/channels  { recipient_id }        -> a DM channel { id }
 *   2. POST /channels/{id}/messages { content }          -> the message
 *
 * Needs a bot token, and the bot must share a server with the recipient (and the
 * recipient must allow DMs from server members) or step 1/2 returns 403. That 403
 * and a 404 are per-user and reported as "unreachable" so the caller can guide the
 * user to join the server / open DMs; 401/429/5xx are "error" (systemic).
 */

export interface DiscordResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type DiscordFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<DiscordResponse>;

export type DmResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "unreachable" | "not-configured" | "error"; readonly status?: number };

const API = "https://discord.com/api/v10";

const defaultFetch: DiscordFetch = (url, init) => fetch(url, init);

function readChannelId(value: unknown): string | null {
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

export class DiscordDmSender {
  readonly #botToken: string | null;
  readonly #fetch: DiscordFetch;

  constructor(botToken: string | null, fetchImpl: DiscordFetch = defaultFetch) {
    this.#botToken = botToken && botToken.length > 0 ? botToken : null;
    this.#fetch = fetchImpl;
  }

  get isConfigured(): boolean {
    return this.#botToken !== null;
  }

  async send(discordUserId: string, content: string): Promise<DmResult> {
    if (!this.#botToken) return { ok: false, kind: "not-configured" };
    const headers = {
      Authorization: `Bot ${this.#botToken}`,
      "Content-Type": "application/json",
    };

    try {
      const channelResponse = await this.#fetch(`${API}/users/@me/channels`, {
        method: "POST",
        headers,
        body: JSON.stringify({ recipient_id: discordUserId }),
      });
      if (!channelResponse.ok) return classify(channelResponse.status);

      const channelId = readChannelId(await channelResponse.json());
      if (!channelId) return { ok: false, kind: "error" };

      const messageResponse = await this.#fetch(`${API}/channels/${channelId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content }),
      });
      if (!messageResponse.ok) return classify(messageResponse.status);

      return { ok: true };
    } catch {
      return { ok: false, kind: "error" };
    }
  }
}

function classify(status: number): DmResult {
  if (status === 403 || status === 404) return { ok: false, kind: "unreachable", status };
  return { ok: false, kind: "error", status };
}
