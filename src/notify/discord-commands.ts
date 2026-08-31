import type { DiscordResponse } from "./discord-dm.js";

/**
 * The `/link <character>` slash command: registration (as a guild command, which is
 * instant, unlike global commands), interaction parsing, and the ephemeral reply. The
 * gateway delivers INTERACTION_CREATE; this turns it into a `SlashInteraction` and
 * answers it. Linking a Discord id to a character from here is unverified — anyone can
 * claim a name — which is fine for a broadcast buff bot and is the price of one-step ease.
 */

export type CommandFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<DiscordResponse>;

export interface SlashInteraction {
  readonly id: string;
  readonly token: string;
  readonly commandName: string;
  /** The invoking user's Discord id (from member.user in a guild, or user in a DM). */
  readonly userId: string | null;
  /** Command options as name → string value (we only use string options). */
  readonly options: Record<string, string>;
}

const API = "https://discord.com/api/v10";
const OPTION_TYPE_STRING = 3;
const INTERACTION_APPLICATION_COMMAND = 2;
const defaultFetch: CommandFetch = (url, init) => fetch(url, init);

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function str(o: Record<string, unknown> | null, k: string): string | null {
  const v = o?.[k];
  return typeof v === "string" ? v : null;
}

/** Turn a raw INTERACTION_CREATE payload into a SlashInteraction, or null if it isn't one. */
export function parseSlashInteraction(data: Record<string, unknown>): SlashInteraction | null {
  if (data.type !== INTERACTION_APPLICATION_COMMAND) return null;
  const id = str(data, "id");
  const token = str(data, "token");
  const cmd = rec(data.data);
  const commandName = str(cmd, "name");
  if (!id || !token || !commandName) return null;

  const member = rec(data.member);
  const userId = str(rec(member?.user), "id") ?? str(rec(data.user), "id");

  const options: Record<string, string> = {};
  const rawOptions = cmd?.options;
  if (Array.isArray(rawOptions)) {
    for (const entry of rawOptions) {
      const o = rec(entry);
      const name = str(o, "name");
      const value = o?.value;
      if (name && typeof value === "string") options[name] = value;
    }
  }
  return { id, token, commandName, userId, options };
}

/** Register `/link <character>` as a guild command (instant). Returns whether it stuck. */
export async function registerLinkCommand(
  token: string,
  applicationId: string,
  guildId: string,
  fetchImpl: CommandFetch = defaultFetch,
): Promise<boolean> {
  const body = [
    {
      name: "link",
      description: "Link your WoW character so you get its world-buff alerts here",
      options: [
        {
          name: "character",
          description: "Your WoW character name",
          type: OPTION_TYPE_STRING,
          required: true,
        },
      ],
    },
  ];
  try {
    const response = await fetchImpl(`${API}/applications/${applicationId}/guilds/${guildId}/commands`, {
      method: "PUT",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Answer an interaction with an ephemeral (only-they-see-it) message. */
export async function replyToInteraction(
  interaction: Pick<SlashInteraction, "id" | "token">,
  content: string,
  fetchImpl: CommandFetch = defaultFetch,
): Promise<void> {
  try {
    await fetchImpl(`${API}/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: 4, data: { content, flags: 64 } }), // 4 = message, 64 = ephemeral
    });
  } catch {
    // best-effort: the link already happened; a failed ack just means no visible reply
  }
}
