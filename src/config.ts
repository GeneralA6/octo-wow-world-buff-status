import type { LogLevel } from "./logger.js";

export interface BotConfig {
  readonly account: string;
  readonly password: string;
  readonly authHost: string;
  readonly authPort: number;
  readonly realm: string;
  readonly characterName: string;
  /** Optional world-server override; when unset the realm list is used. */
  readonly worldHost: string | null;
  readonly worldPort: number | null;
  readonly watchAreaId: number;
  readonly watchAreaName: string;
  readonly pollIntervalMs: number;
  readonly discordWebhookUrl: string;
  /** Role to ping on raid enter/leave so only opted-in members are notified. */
  readonly discordMentionRoleId: string | null;
  readonly logLevel: LogLevel;
}

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** Read and validate configuration from an environment map. Throws listing all problems. */
export function loadConfig(env: NodeJS.ProcessEnv): BotConfig {
  const errors: string[] = [];

  const required = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) {
      errors.push(`${key} is required`);
      return "";
    }
    return value;
  };

  const intWithDefault = (key: string, fallback: number, min: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      errors.push(`${key} must be an integer >= ${min}`);
      return fallback;
    }
    return value;
  };

  const account = required("WOW_ACCOUNT");
  const password = required("WOW_PASSWORD");
  const authHost = env.WOW_AUTH_HOST?.trim() || "octowow.st";
  const authPort = intWithDefault("WOW_AUTH_PORT", 3724, 1);
  const realm = env.WOW_REALM?.trim() || "N'Zoth";
  const characterName = required("WOW_CHARACTER");

  const worldHost = env.WOW_WORLD_HOST?.trim() || null;
  const worldPortRaw = env.WOW_WORLD_PORT?.trim();
  const worldPort = worldPortRaw ? intWithDefault("WOW_WORLD_PORT", 0, 1) : null;

  const watchAreaId = intWithDefault("WATCH_AREA_ID", 2159, 1);
  const watchAreaName = env.WATCH_AREA_NAME?.trim() || "Onyxia's Lair";
  const pollIntervalMs = intWithDefault("POLL_INTERVAL_SECONDS", 20, 5) * 1000;

  const discordWebhookUrl = required("DISCORD_WEBHOOK_URL");

  const discordMentionRoleId = env.DISCORD_MENTION_ROLE_ID?.trim() || null;
  if (discordMentionRoleId && !/^\d+$/.test(discordMentionRoleId)) {
    errors.push("DISCORD_MENTION_ROLE_ID must be a numeric Discord role id");
  }

  const logLevelRaw = (env.LOG_LEVEL?.trim() || "info") as LogLevel;
  const logLevel: LogLevel = LOG_LEVELS.includes(logLevelRaw) ? logLevelRaw : "info";
  if (env.LOG_LEVEL && !LOG_LEVELS.includes(logLevelRaw)) {
    errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join("\n  - ")}`);
  }

  return {
    account,
    password,
    authHost,
    authPort,
    realm,
    characterName,
    worldHost,
    worldPort,
    watchAreaId,
    watchAreaName,
    pollIntervalMs,
    discordWebhookUrl,
    discordMentionRoleId,
    logLevel,
  };
}

/** Split a realm-list "host:port" address; falls back to the default world port. */
export function parseAddress(address: string, defaultPort = 8085): { host: string; port: number } {
  const lastColon = address.lastIndexOf(":");
  if (lastColon === -1) return { host: address, port: defaultPort };
  const host = address.slice(0, lastColon);
  const port = Number(address.slice(lastColon + 1));
  return { host, port: Number.isInteger(port) && port > 0 ? port : defaultPort };
}
