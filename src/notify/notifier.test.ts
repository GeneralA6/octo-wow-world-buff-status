import { describe, expect, it, vi } from "vitest";
import {
  DiscordWebhookNotifier,
  type HttpPostJson,
  type HttpResponse,
} from "./notifier.js";

const WEBHOOK = "https://discord.com/api/webhooks/123/abc";

function fakeResponse(ok: boolean, status: number, body = ""): HttpResponse {
  return { ok, status, text: () => Promise.resolve(body) };
}

interface ParsedPayload {
  embeds: { title: string; description: string; color: number }[];
  content?: string;
  allowed_mentions?: { parse: string[]; roles: string[]; users: string[] };
}

function parsePayload(post: ReturnType<typeof vi.fn<HttpPostJson>>): ParsedPayload {
  return JSON.parse(post.mock.calls[0][1]) as ParsedPayload;
}

describe("DiscordWebhookNotifier", () => {
  it("rejects a URL that is not a Discord webhook", () => {
    expect(() => new DiscordWebhookNotifier("https://example.com/hook")).toThrow(
      /discord\.com webhook/,
    );
  });

  it("accepts the discordapp.com host too", () => {
    expect(
      () => new DiscordWebhookNotifier("https://discordapp.com/api/webhooks/1/x"),
    ).not.toThrow();
  });

  it("posts an embed with the right title, body and colour", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 204));
    const notifier = new DiscordWebhookNotifier(WEBHOOK, { post });

    await notifier.notify({ kind: "entered", title: "Raid entered", body: "40 players" });

    expect(post).toHaveBeenCalledTimes(1);
    const [url] = post.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(parsePayload(post).embeds[0]).toEqual({
      title: "Raid entered",
      description: "40 players",
      color: 0xe67e22,
    });
  });

  it("uses a distinct colour for the 'left' kind", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 204));
    await new DiscordWebhookNotifier(WEBHOOK, { post }).notify({
      kind: "left",
      title: "cleared",
      body: "gone",
    });
    expect(parsePayload(post).embeds[0].color).toBe(0x2ecc71);
  });

  it("does not mention anyone when no role id is configured", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 204));
    await new DiscordWebhookNotifier(WEBHOOK, { post }).notify({
      kind: "entered",
      title: "t",
      body: "b",
    });
    const payload = parsePayload(post);
    expect(payload.content).toBeUndefined();
    expect(payload.allowed_mentions).toBeUndefined();
  });

  it("pings the configured role on an 'entered' message", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 204));
    await new DiscordWebhookNotifier(WEBHOOK, { post, mentionRoleId: "998877" }).notify({
      kind: "entered",
      title: "t",
      body: "b",
    });
    const payload = parsePayload(post);
    expect(payload.content).toBe("<@&998877>");
    expect(payload.allowed_mentions).toEqual({ parse: [], roles: ["998877"], users: [] });
  });

  it("pings registered users personally, and both a role and users together", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 204));
    await new DiscordWebhookNotifier(WEBHOOK, { post, mentionRoleId: "42" }).notify({
      kind: "entered",
      title: "t",
      body: "b",
      mentionUserIds: ["111", "222"],
    });
    const payload = parsePayload(post);
    expect(payload.content).toBe("<@&42> <@111> <@222>");
    expect(payload.allowed_mentions).toEqual({ parse: [], roles: ["42"], users: ["111", "222"] });
  });

  it("pings only the users when no role is configured", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 204));
    await new DiscordWebhookNotifier(WEBHOOK, { post }).notify({
      kind: "left",
      title: "t",
      body: "b",
      mentionUserIds: ["999"],
    });
    const payload = parsePayload(post);
    expect(payload.content).toBe("<@999>");
    expect(payload.allowed_mentions).toEqual({ parse: [], roles: [], users: ["999"] });
  });

  it("pings the role on 'left' but not on 'info' or 'changed'", async () => {
    const forKind = async (kind: "left" | "info" | "changed") => {
      const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 204));
      await new DiscordWebhookNotifier(WEBHOOK, { post, mentionRoleId: "42" }).notify({
        kind,
        title: "t",
        body: "b",
      });
      return parsePayload(post).content;
    };
    expect(await forKind("left")).toBe("<@&42>");
    expect(await forKind("info")).toBeUndefined();
    expect(await forKind("changed")).toBeUndefined();
  });

  it("resolves on a 2xx response", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 200));
    await expect(
      new DiscordWebhookNotifier(WEBHOOK, { post }).notify({ kind: "info", title: "t", body: "b" }),
    ).resolves.toBeUndefined();
  });

  it("throws with the status and detail on a failure response", async () => {
    const post = vi
      .fn<HttpPostJson>()
      .mockResolvedValue(fakeResponse(false, 429, "rate limited"));
    await expect(
      new DiscordWebhookNotifier(WEBHOOK, { post }).notify({ kind: "info", title: "t", body: "b" }),
    ).rejects.toThrow(/429: rate limited/);
  });
});
