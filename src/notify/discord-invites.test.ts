import { describe, expect, it, vi } from "vitest";
import type { DiscordResponse } from "./discord-dm.js";
import { DiscordInvites, type InviteFetch } from "./discord-invites.js";

function res(ok: boolean, body: unknown, status = ok ? 200 : 403): DiscordResponse {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("DiscordInvites", () => {
  it("creates a single-use invite and returns code + url", async () => {
    const fetchMock = vi.fn<InviteFetch>().mockResolvedValue(res(true, { code: "abc123" }));
    const invites = new DiscordInvites("token", { fetch: fetchMock });
    expect(await invites.createInvite("chan1")).toEqual({
      code: "abc123",
      url: "https://discord.gg/abc123",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/channels/chan1/invites");
    expect(JSON.parse(init.body!)).toMatchObject({ max_uses: 1, unique: true });
  });

  it("returns null when create is forbidden (missing permission)", async () => {
    const fetchMock = vi.fn<InviteFetch>().mockResolvedValue(res(false, {}, 403));
    expect(await new DiscordInvites("token", { fetch: fetchMock }).createInvite("chan1")).toBeNull();
  });

  it("lists invites as code+uses pairs", async () => {
    const body = [
      { code: "aaa", uses: 2, extra: "ignored" },
      { code: "bbb", uses: 0 },
      { notacode: true }, // skipped
    ];
    const fetchMock = vi.fn<InviteFetch>().mockResolvedValue(res(true, body));
    const invites = new DiscordInvites("token", { fetch: fetchMock });
    expect(await invites.listInvites("guild1")).toEqual([
      { code: "aaa", uses: 2 },
      { code: "bbb", uses: 0 },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toContain("/guilds/guild1/invites");
    expect(fetchMock.mock.calls[0]![1].method).toBe("GET");
  });

  it("returns null when listing is forbidden (missing MANAGE_GUILD)", async () => {
    const fetchMock = vi.fn<InviteFetch>().mockResolvedValue(res(false, {}, 403));
    expect(await new DiscordInvites("token", { fetch: fetchMock }).listInvites("g")).toBeNull();
  });

  it("no-ops without a token", async () => {
    const invites = new DiscordInvites(null);
    expect(invites.isConfigured).toBe(false);
    expect(await invites.createInvite("c")).toBeNull();
    expect(await invites.listInvites("g")).toBeNull();
  });
});
