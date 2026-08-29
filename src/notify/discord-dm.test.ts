import { describe, expect, it, vi } from "vitest";
import { DiscordDmSender, type DiscordFetch, type DiscordResponse } from "./discord-dm.js";

function res(ok: boolean, status: number, body: unknown = {}): DiscordResponse {
  return { ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) };
}

describe("DiscordDmSender", () => {
  it("reports not-configured without a token", async () => {
    const result = await new DiscordDmSender(null).send("123", "hi");
    expect(result).toEqual({ ok: false, kind: "not-configured" });
  });

  it("creates a DM channel then posts the message", async () => {
    const fetchImpl = vi.fn<DiscordFetch>()
      .mockResolvedValueOnce(res(true, 200, { id: "chan1" }))
      .mockResolvedValueOnce(res(true, 200));
    const result = await new DiscordDmSender("tok", fetchImpl).send("42", "A raid is forming!");

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [chUrl, chInit] = fetchImpl.mock.calls[0];
    expect(chUrl).toContain("/users/@me/channels");
    expect(chInit.headers.Authorization).toBe("Bot tok");
    expect(JSON.parse(chInit.body)).toEqual({ recipient_id: "42" });
    const [msgUrl, msgInit] = fetchImpl.mock.calls[1];
    expect(msgUrl).toContain("/channels/chan1/messages");
    expect(JSON.parse(msgInit.body)).toEqual({ content: "A raid is forming!" });
  });

  it("classifies a 403 on channel creation as unreachable (no mutual server / DMs closed)", async () => {
    const fetchImpl = vi.fn<DiscordFetch>().mockResolvedValue(res(false, 403));
    const result = await new DiscordDmSender("tok", fetchImpl).send("42", "hi");
    expect(result).toEqual({ ok: false, kind: "unreachable", status: 403 });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never tried to send
  });

  it("classifies a 404 as unreachable and a 500 as error", async () => {
    const notFound = new DiscordDmSender("tok", () => Promise.resolve(res(false, 404)));
    expect(await notFound.send("42", "hi")).toEqual({ ok: false, kind: "unreachable", status: 404 });

    const server = new DiscordDmSender("tok", () => Promise.resolve(res(false, 500)));
    expect(await server.send("42", "hi")).toEqual({ ok: false, kind: "error", status: 500 });
  });

  it("classifies a failed message send after a good channel create", async () => {
    const fetchImpl = vi.fn<DiscordFetch>()
      .mockResolvedValueOnce(res(true, 200, { id: "chan1" }))
      .mockResolvedValueOnce(res(false, 403));
    expect(await new DiscordDmSender("tok", fetchImpl).send("42", "hi")).toEqual({
      ok: false,
      kind: "unreachable",
      status: 403,
    });
  });

  it("treats a channel response with no id as an error", async () => {
    const fetchImpl = vi.fn<DiscordFetch>().mockResolvedValue(res(true, 200, { nope: true }));
    expect(await new DiscordDmSender("tok", fetchImpl).send("42", "hi")).toEqual({ ok: false, kind: "error" });
  });

  it("treats a thrown fetch as an error", async () => {
    const fetchImpl: DiscordFetch = () => Promise.reject(new Error("network"));
    expect(await new DiscordDmSender("tok", fetchImpl).send("42", "hi")).toEqual({ ok: false, kind: "error" });
  });
});
