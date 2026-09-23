import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.js";
import type { ChannelMessage, CreateResult, DmResult } from "../notify/discord-dm.js";
import { renderWall, WallOfShame, type WallChannel } from "./wall-of-shame.js";
import { InMemoryWallOfShameStore, type WallOfShameState } from "./wall-of-shame-store.js";

const OK: DmResult = { ok: true };
const GONE: DmResult = { ok: false, kind: "unreachable", status: 404 };
const FORBIDDEN: DmResult = { ok: false, kind: "unreachable", status: 403 };

function setup(initial: WallOfShameState | null = null) {
  let posted = 0;
  const channel = {
    create: vi.fn(async (_message: ChannelMessage): Promise<CreateResult> => {
      posted += 1;
      return { ok: true, messageId: `msg-${posted}` };
    }),
    edit: vi.fn(async (_messageId: string, _message: ChannelMessage): Promise<DmResult> => OK),
    pin: vi.fn(async (_messageId: string): Promise<DmResult> => OK),
  } satisfies WallChannel;
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const store = new InMemoryWallOfShameStore(initial);
  const wall = new WallOfShame({ channel, store, logger });
  return { wall, channel, store, logger };
}

describe("renderWall", () => {
  it("puts each player on a line of their own", () => {
    expect(renderWall(["Ganker", "Warlockz"])).toEqual({ content: "- Ganker\n- Warlockz", shown: 2 });
  });

  it("shows the earliest players that fit, and how many that is", () => {
    expect(renderWall(["Ganker", "Warlockz", "Late"], "- Ganker\n- Warlockz".length)).toEqual({
      content: "- Ganker\n- Warlockz",
      shown: 2,
    });
  });
});

describe("WallOfShame", () => {
  it("posts and pins the wall with its first player, and remembers the message", async () => {
    const { wall, channel, store } = setup();
    await wall.load();
    await wall.show(["Ganker"]);

    expect(channel.create).toHaveBeenCalledWith({ content: "- Ganker" });
    expect(channel.pin).toHaveBeenCalledWith("msg-1");
    expect(await store.load()).toEqual({ messageId: "msg-1" });
  });

  it("edits the same message as players are added", async () => {
    const { wall, channel } = setup({ messageId: "msg-9" });
    await wall.load();
    await wall.show(["Ganker", "Warlockz"]);

    expect(channel.edit).toHaveBeenCalledWith("msg-9", { content: "- Ganker\n- Warlockz" });
    expect(channel.create).not.toHaveBeenCalled();
    expect(channel.pin).not.toHaveBeenCalled();
  });

  it("posts one wall when two paints come at once", async () => {
    const { wall, channel } = setup();
    await wall.load();
    await Promise.all([wall.show(["Ganker"]), wall.show(["Ganker", "Warlockz"])]);
    expect(channel.create).toHaveBeenCalledTimes(1);
    expect(channel.edit).toHaveBeenCalledWith("msg-1", { content: "- Ganker\n- Warlockz" });
  });

  it("posts and pins the wall again when someone deleted it", async () => {
    const { wall, channel, store, logger } = setup({ messageId: "msg-9" });
    channel.edit.mockResolvedValueOnce(GONE);
    await wall.load();
    await wall.show(["Ganker", "Warlockz"]);

    expect(channel.create).toHaveBeenCalledWith({ content: "- Ganker\n- Warlockz" });
    expect(channel.pin).toHaveBeenCalledWith("msg-1");
    expect(logger.warn).toHaveBeenCalledWith("wall of shame message is gone; posting it again");
    expect(await store.load()).toEqual({ messageId: "msg-1" });
  });

  it("keeps the message when an edit fails for another reason", async () => {
    const { wall, channel, store, logger } = setup({ messageId: "msg-9" });
    channel.edit.mockResolvedValueOnce({ ok: false, kind: "error", status: 500 });
    await wall.load();
    await wall.show(["Ganker"]);

    expect(channel.create).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("wall of shame edit failed (error 500)");
    expect(await store.load()).toEqual({ messageId: "msg-9" });
  });

  it("says what is missing when it cannot pin, and pins on the next change", async () => {
    const { wall, channel, logger } = setup();
    channel.pin.mockResolvedValueOnce(FORBIDDEN);
    await wall.load();
    await wall.show(["Ganker"]);
    expect(logger.error).toHaveBeenCalledWith(
      "wall of shame pin failed (unreachable 403) — the bot needs the Pin Messages permission in its channel",
    );

    await wall.show(["Ganker", "Warlockz"]);
    expect(channel.pin).toHaveBeenCalledTimes(2);
    expect(channel.pin).toHaveBeenLastCalledWith("msg-1");
  });

  it("posts it on the next paint when Discord could not be reached", async () => {
    const { wall, channel, store } = setup();
    channel.create.mockResolvedValueOnce({ ok: false, kind: "error", status: 502 });
    await wall.load();
    await wall.show(["Ganker"]);
    expect(await store.load()).toBeNull();

    await wall.show(["Ganker"]);
    expect(channel.create).toHaveBeenCalledTimes(2);
    expect(await store.load()).toEqual({ messageId: "msg-1" });
  });

  it("posts nothing while nobody has earned a place", async () => {
    const { wall, channel } = setup();
    await wall.load();
    await wall.show([]);
    expect(channel.create).not.toHaveBeenCalled();
    expect(channel.edit).not.toHaveBeenCalled();
  });
});
