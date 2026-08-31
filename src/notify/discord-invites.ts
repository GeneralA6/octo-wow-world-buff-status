import type { DiscordResponse } from "./discord-dm.js";
import type { InviteUse } from "./invite-tracker.js";

/**
 * The two Discord REST calls the personal-invite linking needs:
 *   - createInvite: POST /channels/{id}/invites  (single-use, so it's spent on one join
 *     and self-deletes) — needs CREATE_INSTANT_INVITE on the channel.
 *   - listInvites:  GET  /guilds/{id}/invites     (to read use-counts for the diff) —
 *     needs MANAGE_GUILD.
 * Both return null on any failure (missing token/permissions, network, bad shape) so the
 * caller degrades to "personal invites off" rather than throwing.
 */

export type InviteFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<DiscordResponse>;

export interface CreatedInvite {
  readonly code: string;
  readonly url: string;
}

const API = "https://discord.com/api/v10";
const DEFAULT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // unused personal invites expire in a week
const defaultFetch: InviteFetch = (url, init) => fetch(url, init);

function readString(value: unknown, key: string): string | null {
  if (value && typeof value === "object" && key in value) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function readNumber(value: unknown, key: string): number | null {
  if (value && typeof value === "object" && key in value) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === "number") return v;
  }
  return null;
}

export class DiscordInvites {
  readonly #token: string | null;
  readonly #fetch: InviteFetch;
  readonly #maxAgeSeconds: number;

  constructor(
    botToken: string | null,
    options: { maxAgeSeconds?: number; fetch?: InviteFetch } = {},
  ) {
    this.#token = botToken && botToken.length > 0 ? botToken : null;
    this.#fetch = options.fetch ?? defaultFetch;
    this.#maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  }

  get isConfigured(): boolean {
    return this.#token !== null;
  }

  #headers(): Record<string, string> {
    return { Authorization: `Bot ${this.#token}`, "Content-Type": "application/json" };
  }

  /** Mint a single-use invite to `channelId`; the code+url, or null on any failure. */
  async createInvite(channelId: string): Promise<CreatedInvite | null> {
    if (!this.#token) return null;
    try {
      const response = await this.#fetch(`${API}/channels/${channelId}/invites`, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({ max_age: this.#maxAgeSeconds, max_uses: 1, unique: true }),
      });
      if (!response.ok) return null;
      const code = readString(await response.json(), "code");
      return code ? { code, url: `https://discord.gg/${code}` } : null;
    } catch {
      return null;
    }
  }

  /** The guild's invites with their use-counts, or null on any failure. */
  async listInvites(guildId: string): Promise<InviteUse[] | null> {
    if (!this.#token) return null;
    try {
      const response = await this.#fetch(`${API}/guilds/${guildId}/invites`, {
        method: "GET",
        headers: this.#headers(),
      });
      if (!response.ok) return null;
      const body = await response.json();
      if (!Array.isArray(body)) return null;
      const invites: InviteUse[] = [];
      for (const entry of body) {
        const code = readString(entry, "code");
        if (code !== null) invites.push({ code, uses: readNumber(entry, "uses") ?? 0 });
      }
      return invites;
    } catch {
      return null;
    }
  }
}
