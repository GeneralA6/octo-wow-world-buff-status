import type { LogLevel } from "./logger.js";
import { DEFAULT_INTEGRITY_CHECKSUM } from "./crypto/integrity.js";
import { CLIENT_BUILD } from "./protocol/opcodes.js";
import { OCTOWOW_CDN } from "./net/client-resolver.js";
import type { GroupingMode } from "./watcher/raid-tracker.js";
import type { Faction } from "./watcher/buff-store.js";

const GROUPING_MODES: readonly GroupingMode[] = ["auto", "guild", "lair"];

/** How /who and the buff relate to faction on this realm. */
export type RealmType = "crossfaction" | "faction";

function isGroupingMode(value: string): value is GroupingMode {
  return GROUPING_MODES.some((mode) => mode === value);
}

/** What a listener does once it reaches the world (per-character). */
export type OnLoginAction = "sit" | "interact" | "none";

/**
 * A city-parked yell listener: a second account whose only job is to hear its
 * capital's buff yell. Each has its own dedicated credentials as separate secrets,
 * and an optional on-login action (e.g. /sit, or interact with the nearest object).
 */
export interface ListenerConfig {
  readonly account: string;
  readonly password: string;
  readonly characterName: string;
  readonly onLogin: OnLoginAction;
  /** Which capital this listener stands in, so its /yell reaches that side's crowd. Null
   *  when unset — the listener still hears buff yells, it just can't be a yell mouthpiece. */
  readonly faction: Faction | null;
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
  /** Learned-median clear time replaces the estimate once this many raids are recorded. */
  readonly raidLearnMinSamples: number;
  /** Floor on a plausible clear: shorter form→clear samples are churn, not a real raid,
   *  and are dropped so they can't poison the learned median downward. */
  readonly raidMinClearMs: number;
  /** How long the raid's roster must stay gone to count a departure as a real clear rather
   *  than a wipe (they run back). ~5 min — enough time to corpse-run back to the instance. */
  readonly raidClearSustainedMs: number;
  /** How often the buff-status board is yelled in each capital (default 10 min). */
  readonly statusYellMs: number;
  /** How long a sent park-alert suppresses a repeat for the same city+kind, so a redeploy,
   *  a wipe (count dipping and recovering) or roster churn can't re-broadcast the same
   *  cycle. Reset early when a fresh buff actually drops for that city. */
  readonly broadcastDedupMs: number;
  /** crossfaction (Octo: /who is mixed, gate both cities) or faction (split per side). */
  readonly realmType: RealmType;
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
  /** Discord bot token for posting to the notification/feedback channels; null disables them. */
  readonly discordBotToken: string | null;
  /** The community Discord server invite link, shared by the in-game "discord" command. Null = unset. */
  readonly discordServerInvite: string | null;
  /** Channel the "feedback" command posts player suggestions to (via the bot). Null = not set,
   *  and feedback is still saved + acknowledged, just not posted to Discord. */
  readonly discordFeedbackChannelId: string | null;
  /** Channel the bot posts Onyxia buff notifications to (via the bot token). */
  readonly discordOnyxiaChannelId: string | null;
  /** Role pinged for alliance (Stormwind) notifications, and horde (Orgrimmar) notifications —
   *  a Discord-side opt-in, unrelated to any in-game character's chosen side. */
  readonly discordAllianceRoleId: string | null;
  readonly discordHordeRoleId: string | null;
  /** MongoDB connection string for the subscriber store; null keeps subscribers in memory. */
  readonly mongodbUri: string | null;
  /** MongoDB database name for the subscriber store. */
  readonly mongodbDb: string;
  readonly pollIntervalMs: number;
  /** How long to wait for a /who reply before giving up. Under peak server load /who
   *  can be slow, so this is tunable — raise it if the watcher logs repeated timeouts. */
  readonly whoTimeoutMs: number;
  /** Max distance (yards) a GameObject may be for an "interact" listener to `use` it (sit on
   *  the bench). Tunable because the server range-checks the use, so it needs the character
   *  parked within reach of the bench. */
  readonly interactMaxYd: number;
  /** If set, an "interact" listener only `use`s a GameObject of THIS entry (the stone bench),
   *  ignoring closer non-bench clutter. Null = use whatever object is nearest. */
  readonly interactEntry: number | null;
  /** Guild the bot represents — used in the intro whisper and for auto-invites. */
  readonly guildName: string;
  /** Community name used in the intro whisper. */
  readonly community: string;
  /** Who built the bot — credited in the intro whisper and named for optional gold tips. */
  readonly author: string;
  /** Auto guild-invite players who contact a listener. Needs the watcher to be guilded. */
  readonly guildInviteEnabled: boolean;
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
    const onLoginRaw = env[`${prefix}_ONLOGIN`]?.trim().toLowerCase();
    let onLogin: OnLoginAction = "none";
    if (onLoginRaw === "sit" || onLoginRaw === "interact" || onLoginRaw === "none") {
      onLogin = onLoginRaw;
    } else if (onLoginRaw) {
      errors.push(`${prefix}_ONLOGIN must be "sit", "interact", or "none"`);
    }
    const factionRaw = env[`${prefix}_FACTION`]?.trim().toLowerCase();
    let faction: Faction | null = null;
    if (factionRaw === "alliance" || factionRaw === "horde") faction = factionRaw;
    else if (factionRaw) errors.push(`${prefix}_FACTION must be "alliance" or "horde"`);
    listeners.push({
      account: required(`${prefix}_ACCOUNT`),
      password: required(`${prefix}_PASSWORD`),
      characterName: required(`${prefix}_CHARACTER`),
      onLogin,
      faction,
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
  const raidLearnMinSamples = intWithDefault("WOW_RAID_LEARN_MIN_SAMPLES", 15, 1);
  const raidMinClearMs = intWithDefault("WOW_RAID_MIN_CLEAR_MINUTES", 10, 1) * 60_000;
  const raidClearSustainedMs = intWithDefault("WOW_RAID_CLEAR_SUSTAINED_MINUTES", 5, 1) * 60_000;
  const statusYellMs = intWithDefault("WOW_STATUS_YELL_MINUTES", 10, 1) * 60_000;
  // Default to the buff window: within one head-block cycle we should speak once.
  const broadcastDedupMs = intWithDefault("WOW_BROADCAST_DEDUP_MINUTES", 120, 1) * 60_000;

  const realmRaw = env.WOW_REALM_TYPE?.trim().toLowerCase();
  const realmType: RealmType = realmRaw === "faction" ? "faction" : "crossfaction";
  if (realmRaw && realmRaw !== "faction" && realmRaw !== "crossfaction") {
    errors.push('WOW_REALM_TYPE must be "crossfaction" or "faction"');
  }

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
  const discordFeedbackChannelId = env.DISCORD_FEEDBACK_CHANNEL_ID?.trim() || null;
  const discordOnyxiaChannelId = env.DISCORD_ONYXIA_CHANNEL_ID?.trim() || null;
  const discordAllianceRoleId = env.DISCORD_ALLIANCE_ROLE_ID?.trim() || null;
  const discordHordeRoleId = env.DISCORD_HORDE_ROLE_ID?.trim() || null;
  for (const [name, value] of [
    ["DISCORD_ALLIANCE_ROLE_ID", discordAllianceRoleId],
    ["DISCORD_HORDE_ROLE_ID", discordHordeRoleId],
  ] as const) {
    if (value && !/^\d+$/.test(value)) errors.push(`${name} must be a numeric Discord role id`);
  }
  const mongodbUri = env.MONGODB_URI?.trim() || null;
  const mongodbDb = env.MONGODB_DB?.trim() || "onyxiabot";

  const pollIntervalMs = intWithDefault("POLL_INTERVAL_SECONDS", 20, 5) * 1000;
  const whoTimeoutMs = intWithDefault("WOW_WHO_TIMEOUT_MS", 8_000, 1_000);
  const interactMaxYd = intWithDefault("WOW_INTERACT_MAX_YD", 8, 1);
  const interactEntryRaw = env.WOW_INTERACT_ENTRY?.trim();
  const interactEntry = interactEntryRaw && /^\d+$/.test(interactEntryRaw) ? Number(interactEntryRaw) : null;

  const guildName = env.WOW_GUILD_NAME?.trim() || "Rage Quit";
  const community = env.WOW_COMMUNITY?.trim() || "OctoWoW";
  const author = env.WOW_AUTHOR?.trim() || "Gibom";
  const inviteRaw = env.WOW_GUILD_INVITE?.trim().toLowerCase();
  const guildInviteEnabled = inviteRaw === "true" || inviteRaw === "1";

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
    raidLearnMinSamples,
    raidMinClearMs,
    raidClearSustainedMs,
    statusYellMs,
    broadcastDedupMs,
    realmType,
    raidGrouping,
    raidDetector,
    announceStartup,
    whispersEnabled,
    whisperThrottleMs,
    discordBotToken,
    discordServerInvite,
    discordFeedbackChannelId,
    discordOnyxiaChannelId,
    discordAllianceRoleId,
    discordHordeRoleId,
    mongodbUri,
    mongodbDb,
    pollIntervalMs,
    whoTimeoutMs,
    interactMaxYd,
    interactEntry,
    guildName,
    community,
    author,
    guildInviteEnabled,
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
