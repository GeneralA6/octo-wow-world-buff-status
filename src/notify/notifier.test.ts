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
    const notifier = new DiscordWebhookNotifier(WEBHOOK, post);

    await notifier.notify({ kind: "entered", title: "Raid entered", body: "40 players" });

    expect(post).toHaveBeenCalledTimes(1);
    const [url, jsonBody] = post.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    const parsed = JSON.parse(jsonBody) as {
      embeds: { title: string; description: string; color: number }[];
    };
    expect(parsed.embeds[0]).toEqual({
      title: "Raid entered",
      description: "40 players",
      color: 0xe67e22,
    });
  });

  it("uses a distinct colour for the 'left' kind", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 204));
    await new DiscordWebhookNotifier(WEBHOOK, post).notify({
      kind: "left",
      title: "cleared",
      body: "gone",
    });
    const parsed = JSON.parse(post.mock.calls[0][1]) as { embeds: { color: number }[] };
    expect(parsed.embeds[0].color).toBe(0x2ecc71);
  });

  it("resolves on a 2xx response", async () => {
    const post = vi.fn<HttpPostJson>().mockResolvedValue(fakeResponse(true, 200));
    await expect(
      new DiscordWebhookNotifier(WEBHOOK, post).notify({ kind: "info", title: "t", body: "b" }),
    ).resolves.toBeUndefined();
  });

  it("throws with the status and detail on a failure response", async () => {
    const post = vi
      .fn<HttpPostJson>()
      .mockResolvedValue(fakeResponse(false, 429, "rate limited"));
    await expect(
      new DiscordWebhookNotifier(WEBHOOK, post).notify({ kind: "info", title: "t", body: "b" }),
    ).rejects.toThrow(/429: rate limited/);
  });
});
