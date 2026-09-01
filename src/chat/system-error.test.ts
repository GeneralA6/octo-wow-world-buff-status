import { describe, expect, it } from "vitest";
import { isCommandError } from "./system-error.js";

describe("isCommandError", () => {
  it("flags guild-invite failure messages (server interpolates the name)", () => {
    expect(isCommandError("Raider is already in a guild.")).toBe(true);
    expect(isCommandError("You are not in a guild.")).toBe(true);
    expect(isCommandError("You do not have permission to perform that action.")).toBe(true);
    expect(isCommandError("No player named 'Ghost' is currently playing.")).toBe(true);
    expect(isCommandError("Player not found.")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(isCommandError("RAIDER IS ALREADY IN A GUILD")).toBe(true);
  });

  it("ignores benign system messages", () => {
    expect(isCommandError("Welcome to Turtle WoW!")).toBe(false);
    expect(isCommandError("You have reached level 60!")).toBe(false);
    expect(isCommandError("The server will restart in 15 minutes.")).toBe(false);
  });
});
