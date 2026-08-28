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
    expect(config.authHost).toBe("logon.turtle-wow.org");
    expect(config.authPort).toBe(3724);
    expect(config.realm).toBe("Turtle WoW");
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
