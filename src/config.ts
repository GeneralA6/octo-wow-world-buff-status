import type { LogLevel } from "./logger.js";
import { DEFAULT_INTEGRITY_CHECKSUM } from "./crypto/integrity.js";
import { CLIENT_BUILD } from "./protocol/opcodes.js";
import { OCTOWOW_CDN } from "./net/client-resolver.js";
import type { GroupingMode } from "./watcher/raid-tracker.js";

const GROUPING_MODES: readonly GroupingMode[] = ["auto", "guild", "lair"];

function isGroupingMode(value: string): value is GroupingMode {
  return GROUPING_MODES.some((mode) => mode === value);
}

/**
 * A city-parked yell listener: a second account whose only job is to hear its
 * capital's buff yell. Each has its own dedicated credentials as separate secrets.
 */
export interface ListenerConfig {
  readonly account: string;
  readonly password: string;
  readonly characterName: string;
}

export interface BotConfig {
  readonly account: string;
  readonly password: string;
  readonly authHost: string;
  readonly authPort: number;
  readonly realm: string;
  readonly characterName: string;
  /** Dev toggle: when false the bot never logs the character in, freeing it for manual play. */
  readonly loginEnabled: boolean;
  /** Extra accounts parked in capitals to hear each faction's buff yell. */
  readonly listeners: readonly ListenerConfig[];
  /** Optional world-server override; when unset the realm list is used. */
  readonly worldHost: string | null;
  readonly worldPort: number | null;
  /** Client-integrity checksum for StrictVersionCheck servers; null disables it. */
  readonly integrityChecksum: Buffer | null;
  /** Client build advertised at logon (OctoWoW's custom build; changes on a client patch). */
  readonly build: number;
  /** Client build in the world auth session — OctoWoW sends stock 5875 here, not the logon build. */
  readonly worldBuild: number;
  /** Re-resolve the build + integrity checksum from the CDN when auth is version-rejected (self-heal on patch). */
  readonly autoResolve: boolean;
  /** OctoWoW client CDN base used for auto-resolve. */
  readonly clientCdn: string;
  readonly watchAreaId: number;
  readonly watchAreaName: string;
  /** Members a cohort must reach for a raid to count as forming ("about to start"). */
  readonly minRaidSize: number;
  /** Hysteresis floor: an active raid clears (and re-arms) when it drops below this. */
  readonly raidClearSize: number;
  /** How long the Rallying Cry buff lasts, and blocks the next drop (the head window). */
  readonly buffDurationMs: number;
  /** Estimated Onyxia clear time, used to predict a forming raid's end until learned. */
  readonly raidDurationEstimateMs: number;
  /** How to tell concurrent raids apart: auto (guild raids + a pickup pool), guild, or lair. */
  readonly raidGrouping: GroupingMode;
  /** Which detector drives alerts: "count" (hysteresis) or "temporal" (arrival/departure). */
  readonly raidDetector: "count" | "temporal";
  /** Post a "bot online" message on startup. Off by default to stay quiet. */
  readonly announceStartup: boolean;
  /** Whether the in-game whisper interface (commands + subscriber alerts) is active. */
  readonly whispersEnabled: boolean;
  /** Delay between outgoing whispers (ms) to stay under the server's chat throttle. */
  readonly whisperThrottleMs: number;
  /** Discord bot token for DM delivery + DM-based linking; null disables both. */
  readonly discordBotToken: string | null;
  /** Server invite shown in link instructions (subscribers must share a server to be DM'd). */
  readonly discordServerInvite: string | null;
  /** Run the Discord gateway (link flow A — DM the bot a code). Needs the MESSAGE CONTENT intent. */
  readonly discordGateway: boolean;
  /** MongoDB connection string for the subscriber store; null keeps subscribers in memory. */
  readonly mongodbUri: string | null;
  /** MongoDB database name for the subscriber store. */
  readonly mongodbDb: string;
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
  const authHost = env.WOW_AUTH_HOST?.trim() || "play.octowow.st";
  const authPort = intWithDefault("WOW_AUTH_PORT", 3724, 1);
  const realm = env.WOW_REALM?.trim() || "N'Zoth";
  const characterName = required("WOW_CHARACTER");

  // Dev toggle: WOW_LOGIN_ENABLED=false/0/none keeps the bot logged out so you can
  // play the character yourself without it fighting you for the one allowed session.
  const loginRaw = env.WOW_LOGIN_ENABLED?.trim().toLowerCase();
  const loginEnabled = loginRaw !== "false" && loginRaw !== "0" && loginRaw !== "none";

  // Yell listeners: one per city character, each with its own dedicated
  // WOW_LISTENER_<NAME>_ACCOUNT / _PASSWORD / _CHARACTER. Discovered by scanning for
  // the _ACCOUNT vars, so there is no separate list to keep in sync — just add a set.
  const listeners: ListenerConfig[] = [];
  const listenerLabels = new Set<string>();
  for (const key of Object.keys(env)) {
    const match = /^WOW_LISTENER_(.+)_ACCOUNT$/.exec(key);
    if (match?.[1]) listenerLabels.add(match[1]);
  }
  for (const label of [...listenerLabels].sort()) {
    const prefix = `WOW_LISTENER_${label}`;
    listeners.push({
      account: required(`${prefix}_ACCOUNT`),
      password: required(`${prefix}_PASSWORD`),
      characterName: required(`${prefix}_CHARACTER`),
    });
  }

  const worldHost = env.WOW_WORLD_HOST?.trim() || null;
  const worldPortRaw = env.WOW_WORLD_PORT?.trim();
  const worldPort = worldPortRaw ? intWithDefault("WOW_WORLD_PORT", 0, 1) : null;

  // Client-integrity checksum: defaults to the verified 1.12.1 value; "none" disables.
  const rawChecksum = env.WOW_INTEGRITY_CHECKSUM?.trim();
  let integrityChecksum: Buffer | null = null;
  if (rawChecksum !== "none") {
    const hex = rawChecksum && rawChecksum.length > 0 ? rawChecksum : DEFAULT_INTEGRITY_CHECKSUM;
    if (!/^[0-9a-fA-F]{40}$/.test(hex)) {
      errors.push("WOW_INTEGRITY_CHECKSUM must be 40 hex chars (20 bytes) or 'none'");
    } else {
      integrityChecksum = Buffer.from(hex, "hex");
    }
  }

  const build = intWithDefault("WOW_BUILD", CLIENT_BUILD, 1);
  const worldBuild = intWithDefault("WOW_WORLD_BUILD", 5875, 1);

  const autoResolveRaw = env.WOW_AUTO_RESOLVE?.trim().toLowerCase();
  const autoResolve =
    autoResolveRaw !== "false" && autoResolveRaw !== "0" && autoResolveRaw !== "none";
  const clientCdn = env.WOW_CLIENT_CDN?.trim() || OCTOWOW_CDN;

  const watchAreaId = intWithDefault("WATCH_AREA_ID", 2159, 1);
  const watchAreaName = env.WATCH_AREA_NAME?.trim() || "Onyxia's Lair";
  const minRaidSize = intWithDefault("WOW_MIN_RAID_SIZE", 15, 1);
  const raidClearSize = intWithDefault(
    "WOW_RAID_CLEAR_SIZE",
    Math.max(1, Math.floor(minRaidSize / 3)),
    1,
  );
  if (raidClearSize >= minRaidSize) {
    errors.push("WOW_RAID_CLEAR_SIZE must be less than WOW_MIN_RAID_SIZE");
  }

  const buffDurationMs = intWithDefault("WOW_BUFF_DURATION_MINUTES", 120, 1) * 60_000;
  const raidDurationEstimateMs = intWithDefault("WOW_RAID_DURATION_MINUTES", 45, 1) * 60_000;

  const groupingRaw = env.WOW_RAID_GROUPING?.trim().toLowerCase();
  const raidGrouping: GroupingMode = groupingRaw && isGroupingMode(groupingRaw) ? groupingRaw : "auto";
  if (groupingRaw && !isGroupingMode(groupingRaw)) {
    errors.push(`WOW_RAID_GROUPING must be one of ${GROUPING_MODES.join(", ")}`);
  }

  const detectorRaw = env.WOW_RAID_DETECTOR?.trim().toLowerCase();
  const raidDetector: "count" | "temporal" = detectorRaw === "temporal" ? "temporal" : "count";
  if (detectorRaw && detectorRaw !== "count" && detectorRaw !== "temporal") {
    errors.push('WOW_RAID_DETECTOR must be "count" or "temporal"');
  }

  const announceStartupRaw = env.WOW_ANNOUNCE_STARTUP?.trim().toLowerCase();
  const announceStartup = announceStartupRaw === "true" || announceStartupRaw === "1";

  const whispersRaw = env.WOW_WHISPERS?.trim().toLowerCase();
  const whispersEnabled = whispersRaw !== "false" && whispersRaw !== "0" && whispersRaw !== "none";
  const whisperThrottleMs = intWithDefault("WOW_WHISPER_THROTTLE_MS", 1200, 200);
  const discordBotToken = env.DISCORD_BOT_TOKEN?.trim() || null;
  const discordServerInvite = env.DISCORD_SERVER_INVITE_URL?.trim() || null;
  const gatewayRaw = env.DISCORD_GATEWAY?.trim().toLowerCase();
  const discordGateway = gatewayRaw !== "false" && gatewayRaw !== "0" && gatewayRaw !== "none";
  const mongodbUri = env.MONGODB_URI?.trim() || null;
  const mongodbDb = env.MONGODB_DB?.trim() || "onyxiabot";

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
    loginEnabled,
    listeners,
    worldHost,
    worldPort,
    integrityChecksum,
    build,
    worldBuild,
    autoResolve,
    clientCdn,
    watchAreaId,
    watchAreaName,
    minRaidSize,
    raidClearSize,
    buffDurationMs,
    raidDurationEstimateMs,
    raidGrouping,
    raidDetector,
    announceStartup,
    whispersEnabled,
    whisperThrottleMs,
    discordBotToken,
    discordServerInvite,
    discordGateway,
    mongodbUri,
    mongodbDb,
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
