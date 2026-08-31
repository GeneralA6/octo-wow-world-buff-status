import { describe, expect, it, vi } from "vitest";
import type { DiscordResponse } from "./discord-dm.js";
import {
  type CommandFetch,
  parseSlashInteraction,
  registerLinkCommand,
  replyToInteraction,
} from "./discord-commands.js";

function res(ok: boolean, status = ok ? 200 : 403): DiscordResponse {
  return { ok, status, json: async () => ({}), text: async () => "" };
}

describe("parseSlashInteraction", () => {
  it("reads the command name, options, and the member's user id", () => {
    const parsed = parseSlashInteraction({
      type: 2,
      id: "int1",
      token: "tok1",
      data: { name: "link", options: [{ name: "character", type: 3, value: "Gibom" }] },
      member: { user: { id: "user-99" } },
    });
    expect(parsed).toEqual({
      id: "int1",
      token: "tok1",
      commandName: "link",
      userId: "user-99",
      options: { character: "Gibom" },
    });
  });

  it("falls back to the top-level user id (DM context)", () => {
    const parsed = parseSlashInteraction({
      type: 2,
      id: "i",
      token: "t",
      data: { name: "link" },
      user: { id: "dm-user" },
    });
    expect(parsed?.userId).toBe("dm-user");
  });

  it("returns null for a non-command interaction (e.g. a PING)", () => {
    expect(parseSlashInteraction({ type: 1, id: "i", token: "t" })).toBeNull();
  });
});

describe("registerLinkCommand", () => {
  it("PUTs the link command to the guild endpoint", async () => {
    const fetchMock = vi.fn<CommandFetch>().mockResolvedValue(res(true));
    expect(await registerLinkCommand("token", "app1", "guild1", fetchMock)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/applications/app1/guilds/guild1/commands");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body!)[0]).toMatchObject({ name: "link" });
  });

  it("returns false on failure", async () => {
    const fetchMock = vi.fn<CommandFetch>().mockResolvedValue(res(false, 403));
    expect(await registerLinkCommand("token", "app1", "guild1", fetchMock)).toBe(false);
  });
});

describe("replyToInteraction", () => {
  it("posts an ephemeral message to the callback endpoint", async () => {
    const fetchMock = vi.fn<CommandFetch>().mockResolvedValue(res(true));
    await replyToInteraction({ id: "int1", token: "tok1" }, "Linked!", fetchMock);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/interactions/int1/tok1/callback");
    const payload = JSON.parse(init.body!);
    expect(payload).toMatchObject({ type: 4, data: { content: "Linked!", flags: 64 } });
  });
});
