import { describe, expect, it, vi } from "vitest";
import { InMemorySubscriberStore } from "../subscribers/memory-store.js";
import { PendingLinks } from "../subscribers/pending-links.js";
import { DiscordDmSender, type DiscordFetch, type DiscordResponse } from "../notify/discord-dm.js";
import { DiscordLinker } from "./discord-linker.js";

function res(ok: boolean, status: number, body: unknown = { id: "chan" }): DiscordResponse {
  return { ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve("") };
}

function make(opts: { token?: string | null; fetch?: DiscordFetch } = {}) {
  const store = new InMemorySubscriberStore();
  const pending = new PendingLinks({ generate: () => "CODE01" });
  const dm = new DiscordDmSender(opts.token === undefined ? "tok" : opts.token, opts.fetch);
  const linker = new DiscordLinker({ store, pending, dm, serverInviteUrl: "https://discord.gg/x", areaName: "Onyxia's Lair" });
  return { store, pending, dm, linker };
}

describe("DiscordLinker", () => {
  it("flow A: startDmLink mints a code and subscribes the character", async () => {
    const { store, linker } = make();
    const code = await linker.startDmLink("Raider");
    expect(code).toBe("CODE01");
    expect(await store.has("Raider")).toBe(true);
  });

  it("flow A: confirmFromDm links the DM author's id to the character", async () => {
    const okFetch = vi.fn<DiscordFetch>().mockResolvedValue(res(true, 200));
    const { store, linker } = make({ fetch: okFetch });
    await linker.startDmLink("Raider");
    const character = await linker.confirmFromDm("999888777", "CODE01");
    expect(character).toBe("raider");
    expect((await store.get("Raider"))?.discordId).toBe("999888777");
  });

  it("ignores a DM code that was never minted", async () => {
    const okFetch = vi.fn<DiscordFetch>().mockResolvedValue(res(true, 200));
    const { linker } = make({ fetch: okFetch });
    expect(await linker.confirmFromDm("999888777", "NOSUCH")).toBeNull();
  });

  it("flow B: startIdLink DMs a code and confirmFromWhisper links it, only for the owner", async () => {
    const okFetch = vi.fn<DiscordFetch>().mockResolvedValue(res(true, 200));
    const { store, linker } = make({ fetch: okFetch });
    expect(await linker.startIdLink("Raider", "123456789012345678")).toBe("sent");
    expect(await linker.confirmFromWhisper("SomeoneElse", "CODE01")).toBe(false);
    expect(await linker.confirmFromWhisper("Raider", "CODE01")).toBe(true);
    expect((await store.get("Raider"))?.discordId).toBe("123456789012345678");
  });

  it("flow B: an unreachable DM reports unreachable and drops the code", async () => {
    const badFetch = vi.fn<DiscordFetch>().mockResolvedValue(res(false, 403));
    const { pending, linker } = make({ fetch: badFetch });
    expect(await linker.startIdLink("Raider", "123456789012345678")).toBe("unreachable");
    expect(pending.size).toBe(0);
  });

  it("linkByCommand links a character to an id directly (the /link path)", async () => {
    const { store, linker } = make();
    await linker.linkByCommand("Raider", "555000111");
    expect(await store.has("Raider")).toBe(true);
    expect((await store.get("Raider"))?.discordId).toBe("555000111");
  });

  it("reports not-configured without a bot token", async () => {
    const { linker } = make({ token: null });
    expect(linker.isConfigured).toBe(false);
  });

  it("unlinks a character", async () => {
    const okFetch = vi.fn<DiscordFetch>().mockResolvedValue(res(true, 200));
    const { store, linker } = make({ fetch: okFetch });
    await linker.startDmLink("Raider");
    await linker.confirmFromDm("123456789012345678", "CODE01");
    expect((await store.get("Raider"))?.discordId).toBe("123456789012345678");
    expect(await linker.unlink("Raider")).toBe(true);
    expect((await store.get("Raider"))?.discordId).toBeNull();
  });
});
