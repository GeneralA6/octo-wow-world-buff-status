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
    expect(config.authHost).toBe("octowow.st");
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
