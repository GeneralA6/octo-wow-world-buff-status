import { describe, expect, it, vi } from "vitest";
import { silentLogger, type Logger } from "./logger.js";
import type { ChannelMessage, CreateResult, DmResult } from "./notify/discord-dm.js";
import {
  COLOR_DOWN,
  COLOR_LAGGY,
  COLOR_UP,
  ServerStatusWidget,
  buildServerStatusEmbed,
  humanSpan,
  type LiveRealmStatus,
  type ServerStatusView,
  type StatusChannel,
  type StatusWidgetStore,
} from "./status-widget.js";

const NOW = 1_700_000_000_000;

function view(overrides: Partial<ServerStatusView> = {}): ServerStatusView {
  return {
    realm: "N'Zoth",
    up: true,
    pingMs: 74,
    responsive: true,
    stateSince: NOW - 3 * 60 * 60_000, // up 3h
    watchingSince: NOW - 2 * 24 * 60 * 60_000, // watching 2d
    now: NOW,
    lastOutage: null,
    ...overrides,
  };
}

function fieldValue(embed: ReturnType<typeof buildServerStatusEmbed>, name: string): string | undefined {
  return embed.fields?.find((f) => f.name === name)?.value;
}

describe("humanSpan", () => {
  it("covers minutes, hours, and days", () => {
    expect(humanSpan(0)).toBe("under a minute");
    expect(humanSpan(30_000)).toBe("under a minute");
    expect(humanSpan(42 * 60_000)).toBe("42m");
    expect(humanSpan(3 * 60 * 60_000)).toBe("3h");
    expect(humanSpan((3 * 60 + 20) * 60_000)).toBe("3h20m");
    expect(humanSpan(5 * 24 * 60 * 60_000)).toBe("5d");
    expect(humanSpan((2 * 24 + 4) * 60 * 60_000)).toBe("2d4h");
  });
});

describe("buildServerStatusEmbed", () => {
  it("renders an online, responsive realm green", () => {
    const embed = buildServerStatusEmbed(view());
    expect(embed.color).toBe(COLOR_UP);
    expect(embed.title).toBe("🟢 N'Zoth — Online");
    expect(embed.description).toContain("live");
    expect(fieldValue(embed, "Status")).toBe("Online, up 3h");
    expect(fieldValue(embed, "Realm response")).toBe("Responsive (~74 ms)");
    expect(fieldValue(embed, "Last outage")).toBe("None recorded");
    expect(embed.footer?.text).toBe("Watching for 2d");
    expect(embed.timestamp).toBe(new Date(NOW).toISOString());
  });

  it("renders an up-but-slow realm amber and labels it laggy", () => {
    const embed = buildServerStatusEmbed(view({ responsive: false, pingMs: 260 }));
    expect(embed.color).toBe(COLOR_LAGGY);
    expect(embed.title).toBe("🟡 N'Zoth — Online (laggy)");
    expect(fieldValue(embed, "Realm response")).toBe("Laggy (~260 ms)");
  });

  it("stays green while pings haven't landed yet (checking, not laggy)", () => {
    const embed = buildServerStatusEmbed(view({ responsive: false, pingMs: null }));
    expect(embed.color).toBe(COLOR_UP);
    expect(embed.title).toBe("🟢 N'Zoth — Online");
    expect(fieldValue(embed, "Realm response")).toBe("Checking…");
  });

  it("renders a down realm red, with no realm-response field", () => {
    const embed = buildServerStatusEmbed(view({ up: false, responsive: false, pingMs: null, stateSince: NOW - 12 * 60_000 }));
    expect(embed.color).toBe(COLOR_DOWN);
    expect(embed.title).toBe("🔴 N'Zoth — Down");
    expect(embed.description).toContain("unreachable");
    expect(fieldValue(embed, "Status")).toBe("Down, 12m");
    expect(fieldValue(embed, "Realm response")).toBeUndefined();
  });

  it("shows the last outage when one is recorded", () => {
    const embed = buildServerStatusEmbed(view({ lastOutage: { endedAt: NOW - 2 * 60 * 60_000, durationMs: 12 * 60_000 } }));
    expect(fieldValue(embed, "Last outage")).toBe("2h ago · lasted 12m");
  });

  it("omits the duration when the state's start is unknown", () => {
    expect(fieldValue(buildServerStatusEmbed(view({ stateSince: null })), "Status")).toBe("Online");
    expect(fieldValue(buildServerStatusEmbed(view({ up: false, stateSince: null })), "Status")).toBe("Down");
  });
});

// --- orchestrator ---

function liveSnapshot(overrides: Partial<LiveRealmStatus> = {}): LiveRealmStatus {
  return {
    realm: "N'Zoth",
    up: true,
    pingMs: 74,
    responsive: true,
    stateSince: NOW - 3 * 60 * 60_000,
    watchingSince: NOW - 2 * 24 * 60 * 60_000,
    now: NOW,
    ...overrides,
  };
}

function memoryStore(initial: Awaited<ReturnType<StatusWidgetStore["load"]>> = null): StatusWidgetStore & {
  saved: Array<Awaited<ReturnType<StatusWidgetStore["load"]>>>;
} {
  let state = initial;
  const saved: Array<Awaited<ReturnType<StatusWidgetStore["load"]>>> = [];
  return {
    saved,
    async load() {
      return state;
    },
    async save(next) {
      state = next;
      saved.push(next);
    },
  };
}

function spyLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("ServerStatusWidget", () => {
  it("creates the message the first time and persists its id", async () => {
    const channel: StatusChannel = {
      create: vi.fn<StatusChannel["create"]>().mockResolvedValue({ ok: true, messageId: "m1" } satisfies CreateResult),
      edit: vi.fn<StatusChannel["edit"]>().mockResolvedValue({ ok: true } satisfies DmResult),
    };
    const store = memoryStore();
    const widget = new ServerStatusWidget({ channel, store, snapshot: () => liveSnapshot(), logger: silentLogger });

    await widget.load();
    await widget.refresh();

    expect(channel.create).toHaveBeenCalledOnce();
    expect(channel.edit).not.toHaveBeenCalled();
    expect(store.saved.at(-1)?.messageId).toBe("m1");
  });

  it("edits the same message on the next refresh, never reposting", async () => {
    const channel: StatusChannel = {
      create: vi.fn<StatusChannel["create"]>().mockResolvedValue({ ok: true, messageId: "m1" }),
      edit: vi.fn<StatusChannel["edit"]>().mockResolvedValue({ ok: true }),
    };
    const widget = new ServerStatusWidget({ channel, store: memoryStore(), snapshot: () => liveSnapshot(), logger: silentLogger });

    await widget.load();
    await widget.refresh();
    await widget.refresh();
    await widget.refresh();

    expect(channel.create).toHaveBeenCalledOnce();
    expect(channel.edit).toHaveBeenCalledTimes(2);
    expect(channel.edit).toHaveBeenLastCalledWith("m1", expect.anything());
  });

  it("reposts when the message was deleted (edit 404), but not on other failures", async () => {
    const on404: StatusChannel = {
      create: vi.fn<StatusChannel["create"]>().mockResolvedValue({ ok: true, messageId: "m2" }),
      edit: vi.fn<StatusChannel["edit"]>().mockResolvedValue({ ok: false, kind: "unreachable", status: 404 }),
    };
    const w1 = new ServerStatusWidget({
      channel: on404,
      store: memoryStore({ messageId: "old", lastOutageEndedAt: null, lastOutageDurationMs: null }),
      snapshot: () => liveSnapshot(),
      logger: silentLogger,
    });
    await w1.load();
    await w1.refresh();
    expect(on404.edit).toHaveBeenCalledOnce(); // tried the old id
    expect(on404.create).toHaveBeenCalledOnce(); // then reposted

    const on403: StatusChannel = {
      create: vi.fn<StatusChannel["create"]>().mockResolvedValue({ ok: true, messageId: "m3" }),
      edit: vi.fn<StatusChannel["edit"]>().mockResolvedValue({ ok: false, kind: "unreachable", status: 403 }),
    };
    const w2 = new ServerStatusWidget({
      channel: on403,
      store: memoryStore({ messageId: "old", lastOutageEndedAt: null, lastOutageDurationMs: null }),
      snapshot: () => liveSnapshot(),
      logger: spyLogger(),
    });
    await w2.load();
    await w2.refresh();
    expect(on403.edit).toHaveBeenCalledOnce();
    expect(on403.create).not.toHaveBeenCalled(); // a perms error is NOT a "recreate" signal
  });

  it("records a finished outage: persists it and shows it on the widget", async () => {
    const edited: ChannelMessage[] = [];
    const channel: StatusChannel = {
      create: vi.fn<StatusChannel["create"]>().mockResolvedValue({ ok: true, messageId: "m1" }),
      edit: vi.fn<StatusChannel["edit"]>().mockImplementation(async (_id, message) => {
        edited.push(message);
        return { ok: true };
      }),
    };
    const store = memoryStore({ messageId: "m1", lastOutageEndedAt: null, lastOutageDurationMs: null });
    const widget = new ServerStatusWidget({ channel, store, snapshot: () => liveSnapshot(), logger: silentLogger });

    await widget.load();
    await widget.recordOutageEnd(NOW, 12 * 60_000);

    expect(store.saved.at(-1)).toEqual({ messageId: "m1", lastOutageEndedAt: NOW, lastOutageDurationMs: 12 * 60_000 });
    const outageField = edited.at(-1)?.embeds?.[0]?.fields?.find((f) => f.name === "Last outage");
    expect(outageField?.value).toContain("lasted 12m");
  });

  it("restores a persisted outage on load and shows it without a repost", async () => {
    const channel: StatusChannel = {
      create: vi.fn<StatusChannel["create"]>().mockResolvedValue({ ok: true, messageId: "new" }),
      edit: vi.fn<StatusChannel["edit"]>().mockResolvedValue({ ok: true }),
    };
    const widget = new ServerStatusWidget({
      channel,
      store: memoryStore({ messageId: "kept", lastOutageEndedAt: NOW - 60 * 60_000, lastOutageDurationMs: 5 * 60_000 }),
      snapshot: () => liveSnapshot(),
      logger: silentLogger,
    });

    await widget.load();
    await widget.refresh();

    expect(channel.create).not.toHaveBeenCalled();
    expect(channel.edit).toHaveBeenCalledWith("kept", expect.anything());
  });

  it("serialises concurrent refreshes into a single post", async () => {
    // A single controlled promise the first create blocks on — its resolver is set synchronously
    // during construction, so we can release it whenever, before or after create is invoked.
    let resolveCreate: (r: CreateResult) => void = () => {};
    const createPromise = new Promise<CreateResult>((resolve) => {
      resolveCreate = resolve;
    });
    const channel: StatusChannel = {
      create: vi.fn<StatusChannel["create"]>().mockReturnValue(createPromise),
      edit: vi.fn<StatusChannel["edit"]>().mockResolvedValue({ ok: true }),
    };
    const widget = new ServerStatusWidget({ channel, store: memoryStore(), snapshot: () => liveSnapshot(), logger: silentLogger });
    await widget.load();

    const first = widget.refresh(); // starts a create and blocks on it
    const second = widget.refresh(); // must wait for the first, not start a second create
    resolveCreate({ ok: true, messageId: "m1" });
    await Promise.all([first, second]);

    expect(channel.create).toHaveBeenCalledOnce(); // the second refresh edited m1 instead of creating
    expect(channel.edit).toHaveBeenCalledWith("m1", expect.anything());
  });
});
