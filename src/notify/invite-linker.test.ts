import { describe, expect, it, vi } from "vitest";
import { InMemorySubscriberStore } from "../subscribers/memory-store.js";
import type { CreatedInvite, InvitesApi } from "./discord-invites.js";
import type { InviteUse } from "./invite-tracker.js";
import { InviteLinker } from "./invite-linker.js";

/** A fake invites API whose invite list is scripted per call. */
function fakeInvites(lists: InviteUse[][]): InvitesApi & { created: string[] } {
  let call = 0;
  const created: string[] = [];
  let counter = 0;
  return {
    created,
    isConfigured: true,
    async createInvite(): Promise<CreatedInvite | null> {
      const code = `code${++counter}`;
      created.push(code);
      return { code, url: `https://discord.gg/${code}` };
    },
    async listInvites(): Promise<InviteUse[] | null> {
      return lists[Math.min(call++, lists.length - 1)] ?? [];
    },
  };
}

function make(invites: InvitesApi) {
  const store = new InMemorySubscriberStore();
  const dm = { send: vi.fn().mockResolvedValue({ ok: true }) };
  const linker = new InviteLinker({
    invites,
    store,
    dm,
    guildId: "g1",
    channelId: "c1",
    areaName: "Onyxia's Lair",
  });
  return { store, dm, linker };
}

describe("InviteLinker", () => {
  it("mints a personal invite and remembers the character", async () => {
    const invites = fakeInvites([[]]);
    const { linker, store } = make(invites);
    const url = await linker.mintFor("Gibom");
    expect(url).toBe("https://discord.gg/code1");
    expect(invites.created).toEqual(["code1"]);
    expect(await store.has("Gibom")).toBe(true); // minting subscribes them
  });

  it("links the joiner to the character whose single-use invite was consumed", async () => {
    // refresh sees code1 (unused); on join, code1 has vanished (single-use, spent).
    const invites = fakeInvites([[{ code: "code1", uses: 0 }], []]);
    const { linker, store, dm } = make(invites);
    await linker.mintFor("Gibom"); // code1 -> Gibom
    await linker.refresh();
    await linker.onMemberJoin("discord-999");
    expect((await store.get("Gibom"))?.discordId).toBe("discord-999");
    expect(dm.send).toHaveBeenCalledWith("discord-999", expect.stringMatching(/Linked/));
  });

  it("does not link when two invites change at once (ambiguous join)", async () => {
    const invites = fakeInvites([
      [
        { code: "code1", uses: 0 },
        { code: "code2", uses: 0 },
      ],
      [
        { code: "code1", uses: 1 },
        { code: "code2", uses: 1 },
      ],
    ]);
    const { linker, store } = make(invites);
    // pretend both were minted
    await linker.mintFor("Gibom");
    await linker.mintFor("Other");
    await linker.refresh();
    await linker.onMemberJoin("discord-999");
    expect((await store.get("Gibom"))?.discordId ?? null).toBeNull();
  });

  it("ignores a join via an invite we don't own", async () => {
    const invites = fakeInvites([[{ code: "static", uses: 5 }], [{ code: "static", uses: 6 }]]);
    const { linker, store, dm } = make(invites);
    await store.add("Gibom");
    await linker.refresh();
    await linker.onMemberJoin("discord-999");
    expect((await store.get("Gibom"))?.discordId ?? null).toBeNull();
    expect(dm.send).not.toHaveBeenCalled();
  });

  it("is unconfigured without a guild or channel id", () => {
    const invites = fakeInvites([[]]);
    const store = new InMemorySubscriberStore();
    const dm = { send: vi.fn() };
    const linker = new InviteLinker({ invites, store, dm, guildId: null, channelId: null, areaName: "x" });
    expect(linker.isConfigured).toBe(false);
  });
});
