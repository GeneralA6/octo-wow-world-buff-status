import { describe, expect, it } from "vitest";
import { loadConfig, parseAddress } from "./config.js";

const minimalEnv = {
  WOW_ACCOUNT: "botacct",
  WOW_PASSWORD: "secret",
  WOW_CHARACTER: "Botchar",
} satisfies NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("fills defaults for a minimal valid environment", () => {
    const config = loadConfig({ ...minimalEnv });
    expect(config.authHost).toBe("play.octowow.st");
    expect(config.authPort).toBe(3724);
    expect(config.realm).toBe("N'Zoth");
    expect(config.watchAreaId).toBe(2159);
    expect(config.watchAreaName).toBe("Onyxia's Lair");
    expect(config.pollIntervalMs).toBe(20_000);
    expect(config.worldHost).toBeNull();
    expect(config.worldPort).toBeNull();
    expect(config.logLevel).toBe("info");
  });

  it("collects every missing required field into one error", () => {
    expect(() => loadConfig({})).toThrow(
      /WOW_ACCOUNT is required[\s\S]*WOW_PASSWORD is required[\s\S]*WOW_CHARACTER is required/,
    );
  });

  it("converts the poll interval from seconds to milliseconds", () => {
    const config = loadConfig({ ...minimalEnv, POLL_INTERVAL_SECONDS: "30" });
    expect(config.pollIntervalMs).toBe(30_000);
  });

  it("rejects a poll interval below the floor", () => {
    expect(() => loadConfig({ ...minimalEnv, POLL_INTERVAL_SECONDS: "2" })).toThrow(
      /POLL_INTERVAL_SECONDS must be an integer >= 5/,
    );
  });

  it("keeps a world-server override when provided", () => {
    const config = loadConfig({
      ...minimalEnv,
      WOW_WORLD_HOST: "world.example.com",
      WOW_WORLD_PORT: "8085",
    });
    expect(config.worldHost).toBe("world.example.com");
    expect(config.worldPort).toBe(8085);
  });

  it("rejects an unknown log level", () => {
    expect(() => loadConfig({ ...minimalEnv, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL must be/);
  });

  it("rejects a non-numeric faction role id", () => {
    expect(() => loadConfig({ ...minimalEnv, DISCORD_ALLIANCE_ROLE_ID: "@Alliance" })).toThrow(
      /DISCORD_ALLIANCE_ROLE_ID must be a numeric/,
    );
    expect(() => loadConfig({ ...minimalEnv, DISCORD_HORDE_ROLE_ID: "@Horde" })).toThrow(
      /DISCORD_HORDE_ROLE_ID must be a numeric/,
    );
  });

  it("defaults the integrity checksum to a 20-byte value", () => {
    const checksum = loadConfig({ ...minimalEnv }).integrityChecksum;
    expect(checksum?.length).toBe(20);
  });

  it("disables the integrity checksum when set to 'none'", () => {
    const config = loadConfig({ ...minimalEnv, WOW_INTEGRITY_CHECKSUM: "none" });
    expect(config.integrityChecksum).toBeNull();
  });

  it("rejects a malformed integrity checksum", () => {
    expect(() => loadConfig({ ...minimalEnv, WOW_INTEGRITY_CHECKSUM: "xyz" })).toThrow(
      /WOW_INTEGRITY_CHECKSUM must be 40 hex/,
    );
  });

  it("defaults the build and accepts a WOW_BUILD override", () => {
    expect(loadConfig({ ...minimalEnv }).build).toBe(7272);
    expect(loadConfig({ ...minimalEnv, WOW_BUILD: "5875" }).build).toBe(5875);
  });

  it("defaults the world build to 5875", () => {
    expect(loadConfig({ ...minimalEnv }).worldBuild).toBe(5875);
  });

  it("enables auto-resolve by default and points at the OctoWoW CDN", () => {
    const config = loadConfig({ ...minimalEnv });
    expect(config.autoResolve).toBe(true);
    expect(config.clientCdn).toContain("octowow");
  });

  it("disables auto-resolve when set to false/0/none", () => {
    for (const value of ["false", "0", "none"]) {
      expect(loadConfig({ ...minimalEnv, WOW_AUTO_RESOLVE: value }).autoResolve).toBe(false);
    }
  });

  it("defaults the raid-forming threshold to 15 and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).minRaidSize).toBe(15);
    expect(loadConfig({ ...minimalEnv, WOW_MIN_RAID_SIZE: "20" }).minRaidSize).toBe(20);
  });

  it("rejects a raid-forming threshold below 1", () => {
    expect(() => loadConfig({ ...minimalEnv, WOW_MIN_RAID_SIZE: "0" })).toThrow(
      /WOW_MIN_RAID_SIZE must be an integer >= 1/,
    );
  });

  it("defaults the raid clear floor to a third of the raid size and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).raidClearSize).toBe(5); // floor(15 / 3)
    expect(loadConfig({ ...minimalEnv, WOW_RAID_CLEAR_SIZE: "8" }).raidClearSize).toBe(8);
  });

  it("rejects a clear floor at or above the raid size", () => {
    expect(() => loadConfig({ ...minimalEnv, WOW_RAID_CLEAR_SIZE: "15" })).toThrow(
      /WOW_RAID_CLEAR_SIZE must be less than WOW_MIN_RAID_SIZE/,
    );
  });

  it("defaults the strength size and left floor to the forming size (single-point)", () => {
    const config = loadConfig({ ...minimalEnv, WOW_MIN_RAID_SIZE: "20" });
    expect(config.raidStrengthSize).toBe(20);
    expect(config.raidLeftFloor).toBe(20);
  });

  it("reads a two-point setup: form early, start the clock at strength, leave below the floor", () => {
    const config = loadConfig({
      ...minimalEnv,
      WOW_MIN_RAID_SIZE: "20",
      WOW_RAID_STRENGTH_SIZE: "23",
      WOW_RAID_LEFT_FLOOR: "15",
    });
    expect(config.minRaidSize).toBe(20);
    expect(config.raidStrengthSize).toBe(23);
    expect(config.raidLeftFloor).toBe(15);
  });

  it("rejects a strength size below the forming size", () => {
    expect(() => loadConfig({ ...minimalEnv, WOW_MIN_RAID_SIZE: "20", WOW_RAID_STRENGTH_SIZE: "18" })).toThrow(
      /WOW_RAID_STRENGTH_SIZE must be >= WOW_MIN_RAID_SIZE/,
    );
  });

  it("rejects a left floor above the strength size", () => {
    expect(() =>
      loadConfig({ ...minimalEnv, WOW_MIN_RAID_SIZE: "20", WOW_RAID_STRENGTH_SIZE: "23", WOW_RAID_LEFT_FLOOR: "24" }),
    ).toThrow(/WOW_RAID_LEFT_FLOOR must be <= WOW_RAID_STRENGTH_SIZE/);
  });

  it("defaults the buff duration to 2h and accepts an override in minutes", () => {
    expect(loadConfig({ ...minimalEnv }).buffDurationMs).toBe(120 * 60_000);
    expect(loadConfig({ ...minimalEnv, WOW_BUFF_DURATION_MINUTES: "90" }).buffDurationMs).toBe(90 * 60_000);
  });

  it("defaults the raid-duration estimate to 45m and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).raidDurationEstimateMs).toBe(45 * 60_000);
    expect(loadConfig({ ...minimalEnv, WOW_RAID_DURATION_MINUTES: "30" }).raidDurationEstimateMs).toBe(
      30 * 60_000,
    );
  });

  it("defaults the learn-min-samples to 15 and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).raidLearnMinSamples).toBe(15);
    expect(loadConfig({ ...minimalEnv, WOW_RAID_LEARN_MIN_SAMPLES: "25" }).raidLearnMinSamples).toBe(25);
  });

  it("defaults the min-clear floor to 10 minutes and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).raidMinClearMs).toBe(10 * 60_000);
    expect(loadConfig({ ...minimalEnv, WOW_RAID_MIN_CLEAR_MINUTES: "8" }).raidMinClearMs).toBe(8 * 60_000);
  });

  it("defaults the clear-sustained window to 5 minutes and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).raidClearSustainedMs).toBe(5 * 60_000);
    expect(loadConfig({ ...minimalEnv, WOW_RAID_CLEAR_SUSTAINED_MINUTES: "7" }).raidClearSustainedMs).toBe(7 * 60_000);
  });

  it("defaults the capital status-yell cadence to 10 minutes and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).statusYellMs).toBe(10 * 60_000);
    expect(loadConfig({ ...minimalEnv, WOW_STATUS_YELL_MINUTES: "15" }).statusYellMs).toBe(15 * 60_000);
  });

  it("defaults the /who timeout to 8s and accepts an override for slow peak load", () => {
    expect(loadConfig({ ...minimalEnv }).whoTimeoutMs).toBe(8_000);
    expect(loadConfig({ ...minimalEnv, WOW_WHO_TIMEOUT_MS: "15000" }).whoTimeoutMs).toBe(15_000);
  });

  it("defaults the interact range to 8 yards and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).interactMaxYd).toBe(8);
    expect(loadConfig({ ...minimalEnv, WOW_INTERACT_MAX_YD: "5" }).interactMaxYd).toBe(5);
  });

  it("has no interact-entry target by default, and reads a numeric one", () => {
    expect(loadConfig({ ...minimalEnv }).interactEntry).toBeNull();
    expect(loadConfig({ ...minimalEnv, WOW_INTERACT_ENTRY: "25329" }).interactEntry).toBe(25329);
    expect(loadConfig({ ...minimalEnv, WOW_INTERACT_ENTRY: "notanumber" }).interactEntry).toBeNull();
  });

  it("defaults the realm type to crossfaction and accepts faction", () => {
    expect(loadConfig({ ...minimalEnv }).realmType).toBe("crossfaction");
    expect(loadConfig({ ...minimalEnv, WOW_REALM_TYPE: "faction" }).realmType).toBe("faction");
    expect(loadConfig({ ...minimalEnv, WOW_REALM_TYPE: "CROSSFACTION" }).realmType).toBe("crossfaction");
    expect(() => loadConfig({ ...minimalEnv, WOW_REALM_TYPE: "pvp" })).toThrow(/WOW_REALM_TYPE/);
  });

  it("defaults the raid detector to count and accepts temporal", () => {
    expect(loadConfig({ ...minimalEnv }).raidDetector).toBe("count");
    expect(loadConfig({ ...minimalEnv, WOW_RAID_DETECTOR: "temporal" }).raidDetector).toBe("temporal");
    expect(() => loadConfig({ ...minimalEnv, WOW_RAID_DETECTOR: "magic" })).toThrow(/WOW_RAID_DETECTOR/);
  });

  it("defaults raid grouping to auto and accepts guild/lair", () => {
    expect(loadConfig({ ...minimalEnv }).raidGrouping).toBe("auto");
    expect(loadConfig({ ...minimalEnv, WOW_RAID_GROUPING: "lair" }).raidGrouping).toBe("lair");
    expect(loadConfig({ ...minimalEnv, WOW_RAID_GROUPING: "GUILD" }).raidGrouping).toBe("guild");
  });

  it("rejects an unknown raid grouping", () => {
    expect(() => loadConfig({ ...minimalEnv, WOW_RAID_GROUPING: "instance" })).toThrow(
      /WOW_RAID_GROUPING must be one of/,
    );
  });

  it("keeps the startup announcement off by default and on when opted in", () => {
    expect(loadConfig({ ...minimalEnv }).announceStartup).toBe(false);
    for (const value of ["true", "1"]) {
      expect(loadConfig({ ...minimalEnv, WOW_ANNOUNCE_STARTUP: value }).announceStartup).toBe(true);
    }
    expect(loadConfig({ ...minimalEnv, WOW_ANNOUNCE_STARTUP: "false" }).announceStartup).toBe(false);
  });

  it("defaults to no listeners", () => {
    expect(loadConfig({ ...minimalEnv }).listeners).toEqual([]);
  });

  it("discovers listener sessions from their dedicated vars", () => {
    const config = loadConfig({
      ...minimalEnv,
      WOW_LISTENER_ONYXIABUFFSW_ACCOUNT: "ONYXIABUFFSW",
      WOW_LISTENER_ONYXIABUFFSW_PASSWORD: "pw1",
      WOW_LISTENER_ONYXIABUFFSW_CHARACTER: "Onyxiabuffsw",
      WOW_LISTENER_ONYXIABUFFOG_ACCOUNT: "ONYXIABUFFOG",
      WOW_LISTENER_ONYXIABUFFOG_PASSWORD: "pw2",
      WOW_LISTENER_ONYXIABUFFOG_CHARACTER: "Onyxiabuffog",
    });
    // Sorted by label: ONYXIABUFFOG before ONYXIABUFFSW.
    expect(config.listeners).toEqual([
      { account: "ONYXIABUFFOG", password: "pw2", characterName: "Onyxiabuffog", onLogin: "none", faction: null },
      { account: "ONYXIABUFFSW", password: "pw1", characterName: "Onyxiabuffsw", onLogin: "none", faction: null },
    ]);
  });

  it("reads a per-listener on-login action and rejects a bad one", () => {
    const base = {
      ...minimalEnv,
      WOW_LISTENER_SW_ACCOUNT: "A",
      WOW_LISTENER_SW_PASSWORD: "p",
      WOW_LISTENER_SW_CHARACTER: "Sw",
    };
    expect(loadConfig({ ...base, WOW_LISTENER_SW_ONLOGIN: "interact" }).listeners[0]?.onLogin).toBe("interact");
    expect(loadConfig({ ...base, WOW_LISTENER_SW_ONLOGIN: "SIT" }).listeners[0]?.onLogin).toBe("sit");
    expect(loadConfig({ ...base }).listeners[0]?.onLogin).toBe("none");
    expect(() => loadConfig({ ...base, WOW_LISTENER_SW_ONLOGIN: "dance" })).toThrow(/must be "sit", "interact", or "none"/);
  });

  it("reads a per-listener faction (its capital) and rejects a bad one", () => {
    const base = {
      ...minimalEnv,
      WOW_LISTENER_SW_ACCOUNT: "A",
      WOW_LISTENER_SW_PASSWORD: "p",
      WOW_LISTENER_SW_CHARACTER: "Sw",
    };
    expect(loadConfig({ ...base }).listeners[0]?.faction).toBeNull();
    expect(loadConfig({ ...base, WOW_LISTENER_SW_FACTION: "alliance" }).listeners[0]?.faction).toBe("alliance");
    expect(loadConfig({ ...base, WOW_LISTENER_SW_FACTION: "HORDE" }).listeners[0]?.faction).toBe("horde");
    expect(() => loadConfig({ ...base, WOW_LISTENER_SW_FACTION: "pandaren" })).toThrow(
      /WOW_LISTENER_SW_FACTION must be "alliance" or "horde"/,
    );
  });

  it("defaults the broadcast-dedup window to the buff window (120m) and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).broadcastDedupMs).toBe(120 * 60_000);
    expect(loadConfig({ ...minimalEnv, WOW_BROADCAST_DEDUP_MINUTES: "30" }).broadcastDedupMs).toBe(30 * 60_000);
  });

  it("errors when a discovered listener is missing its password or character", () => {
    expect(() =>
      loadConfig({ ...minimalEnv, WOW_LISTENER_ONYXIABUFFSW_ACCOUNT: "ONYXIABUFFSW" }),
    ).toThrow(
      /WOW_LISTENER_ONYXIABUFFSW_PASSWORD is required[\s\S]*WOW_LISTENER_ONYXIABUFFSW_CHARACTER is required/,
    );
  });

  it("enables login by default and disables it on false/0/none", () => {
    expect(loadConfig({ ...minimalEnv }).loginEnabled).toBe(true);
    for (const value of ["false", "0", "none"]) {
      expect(loadConfig({ ...minimalEnv, WOW_LOGIN_ENABLED: value }).loginEnabled).toBe(false);
    }
    expect(loadConfig({ ...minimalEnv, WOW_LOGIN_ENABLED: "true" }).loginEnabled).toBe(true);
  });

  it("enables in-game whispers by default and disables them on false/0/none", () => {
    expect(loadConfig({ ...minimalEnv }).whispersEnabled).toBe(true);
    for (const value of ["false", "0", "none"]) {
      expect(loadConfig({ ...minimalEnv, WOW_WHISPERS: value }).whispersEnabled).toBe(false);
    }
  });

  it("defaults the whisper throttle and accepts an override", () => {
    expect(loadConfig({ ...minimalEnv }).whisperThrottleMs).toBe(1200);
    expect(loadConfig({ ...minimalEnv, WOW_WHISPER_THROTTLE_MS: "800" }).whisperThrottleMs).toBe(800);
  });

  it("defaults the Discord bot token to null and reads an override", () => {
    expect(loadConfig({ ...minimalEnv }).discordBotToken).toBeNull();
    expect(loadConfig({ ...minimalEnv, DISCORD_BOT_TOKEN: "bot.tok.en" }).discordBotToken).toBe("bot.tok.en");
  });

  it("defaults the guild/community settings and reads overrides", () => {
    const bare = loadConfig({ ...minimalEnv });
    expect(bare.guildName).toBe("Rage Quit");
    expect(bare.community).toBe("OctoWoW");
    expect(bare.author).toBe("Gibom");
    expect(bare.discordFeedbackChannelId).toBeNull();
    expect(bare.discordOnyxiaChannelId).toBeNull();
    expect(bare.discordErrorsChannelId).toBeNull();
    expect(bare.discordAllianceRoleId).toBeNull();
    expect(bare.discordHordeRoleId).toBeNull();
    expect(bare.guildInviteEnabled).toBe(false);
    const configured = loadConfig({
      ...minimalEnv,
      WOW_GUILD_NAME: "Late Night",
      WOW_COMMUNITY: "Turtle",
      WOW_AUTHOR: "Someone",
      WOW_GUILD_INVITE: "true",
      DISCORD_FEEDBACK_CHANNEL_ID: "1543926066907844729",
      DISCORD_ONYXIA_CHANNEL_ID: "1544021433720635392",
      DISCORD_ERRORS_CHANNEL_ID: "1544243835771551794",
      DISCORD_ALLIANCE_ROLE_ID: "111",
      DISCORD_HORDE_ROLE_ID: "222",
    });
    expect(configured.guildName).toBe("Late Night");
    expect(configured.community).toBe("Turtle");
    expect(configured.author).toBe("Someone");
    expect(configured.discordFeedbackChannelId).toBe("1543926066907844729");
    expect(configured.discordOnyxiaChannelId).toBe("1544021433720635392");
    expect(configured.discordErrorsChannelId).toBe("1544243835771551794");
    expect(configured.discordAllianceRoleId).toBe("111");
    expect(configured.discordHordeRoleId).toBe("222");
    expect(configured.guildInviteEnabled).toBe(true);
  });

  it("defaults the Chronicle early-confirm on, and reads the disable overrides", () => {
    const bare = loadConfig({ ...minimalEnv });
    expect(bare.chronicleEnabled).toBe(true); // on by default (a no-op without Mongo)
    expect(loadConfig({ ...minimalEnv, CHRONICLE_ENABLED: "false" }).chronicleEnabled).toBe(false);
    expect(loadConfig({ ...minimalEnv, CHRONICLE_ENABLED: "none" }).chronicleEnabled).toBe(false);
  });

  it("defaults the Mongo settings and reads overrides", () => {
    const bare = loadConfig({ ...minimalEnv });
    expect(bare.mongodbUri).toBeNull();
    expect(bare.mongodbDb).toBe("onyxiabot");
    const configured = loadConfig({
      ...minimalEnv,
      MONGODB_URI: "mongodb://localhost:27017",
      MONGODB_DB: "raids",
    });
    expect(configured.mongodbUri).toBe("mongodb://localhost:27017");
    expect(configured.mongodbDb).toBe("raids");
  });
});

describe("parseAddress", () => {
  it("splits host and port", () => {
    expect(parseAddress("51.15.0.1:8085")).toEqual({ host: "51.15.0.1", port: 8085 });
  });

  it("falls back to the default port when none is present", () => {
    expect(parseAddress("world.turtle-wow.org")).toEqual({
      host: "world.turtle-wow.org",
      port: 8085,
    });
  });

  it("falls back to the default port when the port is not a number", () => {
    expect(parseAddress("host:abc").port).toBe(8085);
  });
});
