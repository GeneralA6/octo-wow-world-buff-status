import { describe, expect, it } from "vitest";
import { loadConfig, parseAddress } from "./config.js";

const minimalEnv = {
  WOW_ACCOUNT: "botacct",
  WOW_PASSWORD: "secret",
  WOW_CHARACTER: "Botchar",
  DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x",
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
      /WOW_ACCOUNT is required[\s\S]*WOW_PASSWORD is required[\s\S]*WOW_CHARACTER is required[\s\S]*DISCORD_WEBHOOK_URL is required/,
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

  it("defaults the mention role to null", () => {
    expect(loadConfig({ ...minimalEnv }).discordMentionRoleId).toBeNull();
  });

  it("keeps a numeric mention role id", () => {
    const config = loadConfig({ ...minimalEnv, DISCORD_MENTION_ROLE_ID: "123456789012345678" });
    expect(config.discordMentionRoleId).toBe("123456789012345678");
  });

  it("rejects a non-numeric mention role id", () => {
    expect(() => loadConfig({ ...minimalEnv, DISCORD_MENTION_ROLE_ID: "@OnyxiaWatch" })).toThrow(
      /DISCORD_MENTION_ROLE_ID must be a numeric/,
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
      { account: "ONYXIABUFFOG", password: "pw2", characterName: "Onyxiabuffog" },
      { account: "ONYXIABUFFSW", password: "pw1", characterName: "Onyxiabuffsw" },
    ]);
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

  it("defaults the Discord DM settings and reads overrides", () => {
    const bare = loadConfig({ ...minimalEnv });
    expect(bare.discordBotToken).toBeNull();
    expect(bare.discordServerInvite).toBeNull();
    expect(bare.discordGateway).toBe(true);
    const configured = loadConfig({
      ...minimalEnv,
      DISCORD_BOT_TOKEN: "bot.tok.en",
      DISCORD_SERVER_INVITE_URL: "https://discord.gg/abc",
      DISCORD_GATEWAY: "false",
    });
    expect(configured.discordBotToken).toBe("bot.tok.en");
    expect(configured.discordServerInvite).toBe("https://discord.gg/abc");
    expect(configured.discordGateway).toBe(false);
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
