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
  /** Whether this listener may be its city's /yell mouthpiece. All listeners always join the whisper
   *  pool; this only governs the public city yell, so a second bot in a capital can be whisper-only
   *  (yeller=false) rather than fight over the single yell slot. Default true. */
  readonly yeller: boolean;
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
  /** Members a cohort must reach for a raid to count as forming ("about to start") — when the
   *  "get ready to park" alert fires. Kept below the true raid strength for lead time. */
  readonly minRaidSize: number;
  /** Members the raid must reach to be "at strength" — when the duration clock starts and the
   *  clear tracker begins following it. The forming alert fires earlier (at minRaidSize), so
   *  the measured form→clear excludes the fill-up. Defaults to minRaidSize (single-point). */
  readonly raidStrengthSize: number;
  /** Below this many of the raid's ROSTER present, the raid is "leaving" — the clear floor.
   *  Held below the plateau so normal churn (repairs, DCs) isn't read as a departure.
   *  Defaults to minRaidSize. */
  readonly raidLeftFloor: number;
  /** Hysteresis floor: an active raid clears (and re-arms) when it drops below this. */
  readonly raidClearSize: number;
  /** Estimated Onyxia clear time, used to predict a raid's end until learned. */
  readonly raidDurationEstimateMs: number;
  /** Learned-median clear time replaces the estimate once this many raids are recorded. */
  readonly raidLearnMinSamples: number;
  /** Lead time for the "about to clear" heads-up: it fires once a raid still in the lair has been
   *  in to within this much of its predicted clear time, so a fresh Rallying Cry should drop soon. */
  readonly raidEndingLeadMs: number;
  /** Arrival-cohort separation: a newcomer joins the tracked raid only if they first appeared
   *  within this long of formation (measured raid assembly is ~2-5 min), so the next raid isn't
   *  absorbed into the current one on a continuously-occupied lair. */
  readonly raidFillWindowMs: number;
  /** The tracked roster never grows past this — a backstop against absorbing a second raid. */
  readonly raidRosterCap: number;
  /** Floor on a plausible clear: shorter form→clear samples are churn, not a real raid,
   *  and are dropped so they can't poison the learned median downward. */
  readonly raidMinClearMs: number;
  /** A form→clear shorter than this (and NOT Chronicle-kill-confirmed) is a DISBAND — a raid that
   *  formed but gave up, not a kill. It fires no park-now and records no duration; if we alerted a
   *  forming for it, a stand-down retracts that. Held above the fastest real clear on record. */
  readonly raidDisbandMs: number;
  /** A buff drop with a raid seen in the lair within this long is a fresh, attributable kill; past
   *  it (with full census coverage) the drop is a saved head turned in from an earlier kill, and the
   *  drop post says so and takes no credit. Set above the slowest real turn-in observed (~78m tail),
   *  but the value is deliberately conservative — 40m keeps only the confident-fresh cases, and slow
   *  turn-ins beyond it are labelled "saved head" (an honest under-claim, never a false credit). */
  readonly raidFreshWindowMs: number;
  /** How long the raid's roster must stay gone to count a departure as a real clear rather
   *  than a wipe (they run back). ~4 min — enough time to corpse-run back to the instance. */
  readonly raidClearSustainedMs: number;
  /** How often the buff-status board is yelled in each capital (default 10 min). */
  readonly statusYellMs: number;
  /** A time-sensitive whisper still queued past this is dropped unsent (default 5 min), so a
   *  throttled queue never delivers a "park now" long after the raid it was about cleared. */
  readonly whisperMaxAgeMs: number;
  /** After the realm answers again post-outage, wait this long confirming it stays up before posting
   *  "back up" — so a flappy crash-recovery doesn't announce recovery prematurely (default 3 min). */
  readonly realmStableMs: number;
  /** How long a sent park-alert suppresses a repeat for the same city+kind, so a redeploy,
   *  a wipe (count dipping and recovering) or roster churn can't re-broadcast the same
   *  cycle. Reset early when a fresh buff actually drops for that city. */
  readonly broadcastDedupMs: number;
  /** Server Rallying Cry cooldown per faction (ms); park alerts are suppressed for a side still
   *  within it. 0 = no cooldown (a buff can drop on any clear). */
  readonly buffCooldownMs: number;
  /** crossfaction (Octo: /who is mixed, gate both cities) or faction (split per side). */
  readonly realmType: RealmType;
  /** How to tell concurrent raids apart: auto (guild raids + a pickup pool), guild, or lair. */
  readonly raidGrouping: GroupingMode;
  /** Legacy selector for the count/temporal detector. Both are now only shadow-logged for
   *  comparison — the FORMING and CLEAR alerts are driven by the ClearTracker's roster state
   *  (formation at strength, sustained-departure clear), so this no longer selects a driver. */
  readonly raidDetector: "count" | "temporal";
  /** Post a "bot online" message on startup. Off by default to stay quiet. */
  readonly announceStartup: boolean;
  /** Whether the in-game whisper interface (commands + subscriber alerts) is active. */
  readonly whispersEnabled: boolean;
  /** Gate broadcast whispers on a live presence sweep — before fanning a broadcast out, briefly
   *  friend each target to learn who is online and skip the offline ones (they'd only burn a
   *  throttle slot on an undeliverable whisper). Fail-open, so off-by-default is purely a rollout
   *  choice. Off unless WOW_PRESENCE_ENABLED is set. */
  readonly presenceEnabled: boolean;
  /** One-off live check: on boot, sweep every subscriber once and log the online/offline split
   *  WITHOUT whispering — proves the add→read→remove pipeline against the real server before the
   *  gate is turned on. Off unless WOW_PRESENCE_PROBE is set. */
  readonly presenceProbe: boolean;
  /** How long a name's online/offline verdict from a presence sweep stays fresh, so clustered
   *  broadcasts (a drop then its about-to-clear) reuse one sweep instead of re-churning the friends
   *  list (default 90s). */
  readonly presenceCacheMs: number;
  /** Delay between outgoing whispers (ms) to stay under the server's chat throttle. */
  readonly whisperThrottleMs: number;
  /** Discord bot token for posting to the notification/feedback channels; null disables them. */
  readonly discordBotToken: string | null;
  /** The community Discord server invite link, shared by the in-game "discord" command. Null = unset. */
  readonly discordServerInvite: string | null;
  /** Global chat channel the LISTENERS join to READ addon world-buff broadcasts (Turtle's "LFT").
   *  Null = disabled (default). Flag-gated OFF because reading a channel is unconfirmed protocol —
   *  set WOW_LFT_CHANNEL=LFT to enable the observe hook and capture the real messages. */
  readonly lftChannel: string | null;
  /** Channel the "feedback" command posts player suggestions to (via the bot). Null = not set,
   *  and feedback is still saved + acknowledged, just not posted to Discord. */
  readonly discordFeedbackChannelId: string | null;
  /** Channel the bot posts Onyxia buff notifications to (via the bot token). */
  readonly discordOnyxiaChannelId: string | null;
  /** Channel the bot posts OPERATIONAL/error notices to (bot stopped, auth failure, self-heal,
   *  store outage). Null = those stay log-only. Kept separate from the public buff channel. */
  readonly discordErrorsChannelId: string | null;
  /** Channel for STAGED / test alerts — features being validated before they go to the public buff
   *  channel (e.g. the LFT head-incoming advance warning). Null falls back to the errors channel. */
  readonly discordTestsChannelId: string | null;
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
  /** Gap between the per-class /who slices when a packed lair (>=49) forces slicing. The server
   *  throttles /who, so firing ~9 slices back-to-back trips it and it stops replying; spacing them
   *  keeps it answering. Mirrors DEFAULT_WHO_SLICE_DELAY_MS in watcher/roster.ts. */
  readonly whoSliceDelayMs: number;
  /** Max distance (yards) a GameObject may be for an "interact" listener to `use` it (sit on
   *  the bench). Tunable because the server range-checks the use, so it needs the character
   *  parked within reach of the bench. */
  readonly interactMaxYd: number;
  /** If set, an "interact" listener only `use`s a GameObject of THIS entry (the stone bench),
   *  ignoring closer non-bench clutter. Null = use whatever object is nearest. */
  readonly interactEntry: number | null;
  /** Guild the bot represents — used in the intro whisper and for auto-invites. */
  readonly guildName: string;
  /** A short region/timezone descriptor for the guild, woven into the recruiting line so a
   *  prospective member knows when it plays (e.g. "an Aussie guild, ACST (UTC+9:30)"). Empty
   *  omits it. */
  readonly guildRegion: string;
  /** Community name used in the intro whisper. */
  readonly community: string;
  /** Who built the bot — credited in the intro whisper and named for optional gold tips. */
  readonly author: string;
  /** Auto guild-invite players who contact a listener. Needs the watcher to be guilded. */
  readonly guildInviteEnabled: boolean;
  /** Chronicle early-confirm: during a departure we detect, a fresh community Onyxia-kill log by
   *  one of the raid's roster confirms the clear and lets us skip the sustained wait (never a
   *  trigger on its own). Needs MongoDB for the dedup ledger; off without it. */
  readonly chronicleEnabled: boolean;
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

  // Per-listener enum parsers (shared by the fields below).
  const parseOnLogin = (raw: string | undefined, ctx: string): OnLoginAction => {
    const value = raw?.trim().toLowerCase();
    if (value === "sit" || value === "interact" || value === "none") return value;
    if (value) errors.push(`${ctx} must be "sit", "interact", or "none"`);
    return "none";
  };
  const parseFaction = (raw: string | undefined, ctx: string): Faction | null => {
    const value = raw?.trim().toLowerCase();
    if (value === "alliance" || value === "horde") return value;
    if (value) errors.push(`${ctx} must be "alliance" or "horde"`);
    return null;
  };

  // Yell listeners: capital-parked characters that hear their side's buff yell and share the whisper
  // load. Configured as ONE JSON array in WOW_LISTENERS — each object is a character:
  //   [{"account":"A","password":"p","character":"Char","faction":"horde","onLogin":"sit","yeller":true}]
  // account/password/character are required; faction ("alliance"|"horde") defaults null, onLogin
  // ("sit"|"interact"|"none") defaults "none", yeller (bool) defaults true. Unset = no listeners
  // (watcher only). JSON so a password may contain any character and fields are self-labelling.
  const listeners: ListenerConfig[] = [];
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const optString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
  const listenersRaw = env.WOW_LISTENERS?.trim();
  if (listenersRaw) {
    let parsed: unknown = [];
    try {
      parsed = JSON.parse(listenersRaw);
    } catch (error) {
      errors.push(`WOW_LISTENERS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(parsed)) {
      errors.push('WOW_LISTENERS must be a JSON array of listener objects, e.g. [{"account":"…","password":"…","character":"…"}]');
    } else {
      parsed.forEach((entry, i) => {
        const nth = i + 1;
        if (!isObject(entry)) {
          errors.push(`WOW_LISTENERS entry ${nth} must be an object`);
          return;
        }
        const requiredString = (key: string): string => {
          const value = entry[key];
          if (typeof value === "string" && value.trim()) return value.trim();
          errors.push(`WOW_LISTENERS entry ${nth} needs a non-empty "${key}"`);
          return "";
        };
        // faction/onLogin: reject a present-but-non-string value; an absent one defaults.
        if (entry.faction !== undefined && optString(entry.faction) === undefined)
          errors.push(`WOW_LISTENERS entry ${nth} "faction" must be a string ("alliance" or "horde")`);
        if (entry.onLogin !== undefined && optString(entry.onLogin) === undefined)
          errors.push(`WOW_LISTENERS entry ${nth} "onLogin" must be a string ("sit", "interact", or "none")`);
        let yeller = true;
        if (typeof entry.yeller === "boolean") yeller = entry.yeller;
        else if (entry.yeller !== undefined) errors.push(`WOW_LISTENERS entry ${nth} "yeller" must be true or false`);
        listeners.push({
          account: requiredString("account"),
          password: requiredString("password"),
          characterName: requiredString("character"),
          faction: parseFaction(optString(entry.faction), `WOW_LISTENERS entry ${nth} "faction"`),
          onLogin: parseOnLogin(optString(entry.onLogin), `WOW_LISTENERS entry ${nth} "onLogin"`),
          yeller,
        });
      });
    }
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
  // "At strength": the duration clock starts here (>= forming, so the alert stays early).
  const raidStrengthSize = intWithDefault("WOW_RAID_STRENGTH_SIZE", minRaidSize, 1);
  if (raidStrengthSize < minRaidSize) {
    errors.push("WOW_RAID_STRENGTH_SIZE must be >= WOW_MIN_RAID_SIZE");
  }
  // The "leaving" floor for clear detection — held below the plateau, so it can't exceed strength.
  const raidLeftFloor = intWithDefault("WOW_RAID_LEFT_FLOOR", minRaidSize, 1);
  if (raidLeftFloor > raidStrengthSize) {
    errors.push("WOW_RAID_LEFT_FLOOR must be <= WOW_RAID_STRENGTH_SIZE");
  }

  const raidDurationEstimateMs = intWithDefault("WOW_RAID_DURATION_MINUTES", 45, 1) * 60_000;
  const raidLearnMinSamples = intWithDefault("WOW_RAID_LEARN_MIN_SAMPLES", 15, 1);
  const raidEndingLeadMs = intWithDefault("WOW_RAID_ENDING_LEAD_MINUTES", 10, 1) * 60_000;
  const raidFillWindowMs = intWithDefault("WOW_RAID_FILL_WINDOW_MINUTES", 5, 1) * 60_000;
  const raidRosterCap = intWithDefault("WOW_RAID_ROSTER_CAP", 30, 1);
  const raidMinClearMs = intWithDefault("WOW_RAID_MIN_CLEAR_MINUTES", 10, 1) * 60_000;
  const raidDisbandMs = intWithDefault("WOW_RAID_DISBAND_MINUTES", 20, 1) * 60_000;
  const raidFreshWindowMs = intWithDefault("WOW_DROP_FRESH_WINDOW_MINUTES", 40, 1) * 60_000;
  const raidClearSustainedMs = intWithDefault("WOW_RAID_CLEAR_SUSTAINED_MINUTES", 4, 1) * 60_000;
  const statusYellMs = intWithDefault("WOW_STATUS_YELL_MINUTES", 10, 1) * 60_000;
  // A time-sensitive whisper (park alert, buff drop) still queued past this is dropped unsent — a
  // heavily-throttled queue would otherwise deliver a "park now" minutes after the raid cleared.
  const whisperMaxAgeMs = intWithDefault("WOW_WHISPER_MAX_AGE_MINUTES", 5, 1) * 60_000;
  const realmStableMs = intWithDefault("WOW_REALM_STABLE_MINUTES", 3, 1) * 60_000;
  // Dedup window: how long a (city, kind) park-alert stays muted if no fresh drop is heard, so a
  // redeploy/wipe/roster-churn re-emitting the same event doesn't re-alert. A drop reopens it
  // sooner (new cycle); this is only the ceiling, separate from the buff cooldown below.
  const broadcastDedupMs = intWithDefault("WOW_BROADCAST_DEDUP_MINUTES", 120, 1) * 60_000;
  // Server Rallying Cry cooldown PER FACTION, in minutes: after a buff drops, a fresh one can't drop
  // for that side until this elapses, so park alerts (forming / about-to-clear / clear) are
  // suppressed for it meanwhile. 0 = NO cooldown (OctoWoW's default — a buff drops on any clear).
  const buffCooldownMs = intWithDefault("WOW_BUFF_COOLDOWN_MINUTES", 0, 0) * 60_000;

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
  const presenceRaw = env.WOW_PRESENCE_ENABLED?.trim().toLowerCase();
  const presenceEnabled = presenceRaw === "true" || presenceRaw === "1";
  const presenceProbeRaw = env.WOW_PRESENCE_PROBE?.trim().toLowerCase();
  const presenceProbe = presenceProbeRaw === "true" || presenceProbeRaw === "1";
  const presenceCacheMs = intWithDefault("WOW_PRESENCE_CACHE_SECONDS", 90, 1) * 1_000;
  const whisperThrottleMs = intWithDefault("WOW_WHISPER_THROTTLE_MS", 1200, 200);
  const discordBotToken = env.DISCORD_BOT_TOKEN?.trim() || null;
  const discordServerInvite = env.DISCORD_SERVER_INVITE_URL?.trim() || null;
  const lftChannel = env.WOW_LFT_CHANNEL?.trim() || null;
  const discordFeedbackChannelId = env.DISCORD_FEEDBACK_CHANNEL_ID?.trim() || null;
  const discordOnyxiaChannelId = env.DISCORD_ONYXIA_CHANNEL_ID?.trim() || null;
  const discordErrorsChannelId = env.DISCORD_ERRORS_CHANNEL_ID?.trim() || null;
  const discordTestsChannelId = env.DISCORD_TESTS_CHANNEL_ID?.trim() || null;
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
  const whoSliceDelayMs = intWithDefault("WOW_WHO_SLICE_DELAY_MS", 1_500, 0);
  const interactMaxYd = intWithDefault("WOW_INTERACT_MAX_YD", 8, 1);
  const interactEntryRaw = env.WOW_INTERACT_ENTRY?.trim();
  const interactEntry = interactEntryRaw && /^\d+$/.test(interactEntryRaw) ? Number(interactEntryRaw) : null;

  const guildName = env.WOW_GUILD_NAME?.trim() || "Rage Quit";
  const guildRegion = env.WOW_GUILD_REGION?.trim() ?? "an Aussie guild, ACST (UTC+9:30)";
  const community = env.WOW_COMMUNITY?.trim() || "OctoWoW";
  const author = env.WOW_AUTHOR?.trim() || "Gibom";
  const inviteRaw = env.WOW_GUILD_INVITE?.trim().toLowerCase();
  const guildInviteEnabled = inviteRaw === "true" || inviteRaw === "1";

  // Chronicle early-confirm: on by default (a no-op without Mongo), disabled with false/0/none.
  const chronicleRaw = env.CHRONICLE_ENABLED?.trim().toLowerCase();
  const chronicleEnabled = chronicleRaw !== "false" && chronicleRaw !== "0" && chronicleRaw !== "none";

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
    raidStrengthSize,
    raidLeftFloor,
    raidClearSize,
    raidDurationEstimateMs,
    raidLearnMinSamples,
    raidEndingLeadMs,
    raidFillWindowMs,
    raidRosterCap,
    raidMinClearMs,
    raidDisbandMs,
    raidFreshWindowMs,
    raidClearSustainedMs,
    statusYellMs,
    whisperMaxAgeMs,
    realmStableMs,
    broadcastDedupMs,
    buffCooldownMs,
    realmType,
    raidGrouping,
    raidDetector,
    announceStartup,
    whispersEnabled,
    presenceEnabled,
    presenceProbe,
    presenceCacheMs,
    whisperThrottleMs,
    discordBotToken,
    discordServerInvite,
    lftChannel,
    discordFeedbackChannelId,
    discordOnyxiaChannelId,
    discordErrorsChannelId,
    discordTestsChannelId,
    discordAllianceRoleId,
    discordHordeRoleId,
    mongodbUri,
    mongodbDb,
    pollIntervalMs,
    whoTimeoutMs,
    whoSliceDelayMs,
    interactMaxYd,
    interactEntry,
    guildName,
    guildRegion,
    community,
    author,
    guildInviteEnabled,
    chronicleEnabled,
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
