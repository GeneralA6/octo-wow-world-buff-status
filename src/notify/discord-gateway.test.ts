import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordGateway, type GatewaySocket } from "./discord-gateway.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A mock gateway socket: captures sent frames and lets a test push server frames. */
class MockSocket implements GatewaySocket {
  readonly sent: Array<Record<string, unknown>> = [];
  #onMessage: (data: string) => void = () => {};
  #onClose: () => void = () => {};

  send(data: string): void {
    const parsed: unknown = JSON.parse(data);
    if (isRecord(parsed)) this.sent.push(parsed);
  }
  close(): void {
    this.#onClose();
  }
  onOpen(): void {}
  onMessage(cb: (data: string) => void): void {
    this.#onMessage = cb;
  }
  onClose(cb: () => void): void {
    this.#onClose = cb;
  }
  onError(): void {}

  receive(payload: Record<string, unknown>): void {
    this.#onMessage(JSON.stringify(payload));
  }
}

const INTENTS = (1 << 0) | (1 << 1) | (1 << 12) | (1 << 15);

function start(socket: MockSocket, onDm = vi.fn()) {
  const gw = new DiscordGateway({ token: "tok", onDirectMessage: onDm, connect: () => socket });
  gw.start();
  return { gw, onDm };
}

/** Bring a fresh gateway to the READY state with the given bot user id. */
function ready(socket: MockSocket, onDm = vi.fn()) {
  const started = start(socket, onDm);
  socket.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
  socket.receive({
    op: 0,
    t: "READY",
    s: 1,
    d: { session_id: "sess", resume_gateway_url: "wss://resume", user: { id: "botid" } },
  });
  return started;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("DiscordGateway", () => {
  it("identifies with the DM intents after HELLO", () => {
    const socket = new MockSocket();
    const { gw } = start(socket);
    socket.receive({ op: 10, d: { heartbeat_interval: 45_000 } });

    const identify = socket.sent.find((m) => m.op === 2);
    expect(identify?.d).toMatchObject({ token: "tok", intents: INTENTS });
    gw.stop();
  });

  it("dispatches a direct message to onDirectMessage", () => {
    const socket = new MockSocket();
    const { gw, onDm } = ready(socket);
    socket.receive({ op: 0, t: "MESSAGE_CREATE", s: 2, d: { author: { id: "user1" }, content: "ONYX-42" } });
    expect(onDm).toHaveBeenCalledWith("user1", "ONYX-42");
    gw.stop();
  });

  it("fires onReady and dispatches a join to onGuildMemberAdd (but not the bot's own)", () => {
    const socket = new MockSocket();
    const onReady = vi.fn();
    const onGuildMemberAdd = vi.fn();
    const gw = new DiscordGateway({
      token: "tok",
      onDirectMessage: vi.fn(),
      onReady,
      onGuildMemberAdd,
      connect: () => socket,
    });
    gw.start();
    socket.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
    socket.receive({
      op: 0,
      t: "READY",
      s: 1,
      d: { session_id: "s", resume_gateway_url: "wss://x", user: { id: "botid" } },
    });
    expect(onReady).toHaveBeenCalledTimes(1);

    socket.receive({ op: 0, t: "GUILD_MEMBER_ADD", s: 2, d: { user: { id: "joiner1" } } });
    expect(onGuildMemberAdd).toHaveBeenCalledWith("joiner1");
    socket.receive({ op: 0, t: "GUILD_MEMBER_ADD", d: { user: { id: "botid" } } }); // its own join
    expect(onGuildMemberAdd).toHaveBeenCalledTimes(1);
    gw.stop();
  });

  it("ignores its own messages, guild messages, other bots, and empty content", () => {
    const socket = new MockSocket();
    const { gw, onDm } = ready(socket);
    socket.receive({ op: 0, t: "MESSAGE_CREATE", d: { author: { id: "botid" }, content: "self" } });
    socket.receive({ op: 0, t: "MESSAGE_CREATE", d: { guild_id: "g", author: { id: "u" }, content: "guild" } });
    socket.receive({ op: 0, t: "MESSAGE_CREATE", d: { author: { id: "u", bot: true }, content: "bot" } });
    socket.receive({ op: 0, t: "MESSAGE_CREATE", d: { author: { id: "u" }, content: "   " } });
    expect(onDm).not.toHaveBeenCalled();
    gw.stop();
  });

  it("heartbeats on the interval, carrying the last sequence", () => {
    const socket = new MockSocket();
    const { gw } = start(socket);
    socket.receive({ op: 10, d: { heartbeat_interval: 1_000 } });
    socket.receive({ op: 0, t: "READY", s: 7, d: { session_id: "s", user: { id: "b" } } });

    vi.advanceTimersByTime(1_000);
    const heartbeat = socket.sent.find((m) => m.op === 1);
    expect(heartbeat).toBeTruthy();
    expect(heartbeat?.d).toBe(7);
    gw.stop();
  });

  it("sends a heartbeat immediately when the server requests one (op 1)", () => {
    const socket = new MockSocket();
    const { gw } = start(socket);
    socket.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
    const before = socket.sent.filter((m) => m.op === 1).length;
    socket.receive({ op: 1 });
    expect(socket.sent.filter((m) => m.op === 1).length).toBe(before + 1);
    gw.stop();
  });

  it("resumes instead of identifying after a reconnect with a live session", () => {
    const socket = new MockSocket();
    const { gw } = ready(socket);
    // A server-requested reconnect closes the socket; the gateway reopens and,
    // holding a session, sends RESUME (op 6) on the next HELLO.
    socket.receive({ op: 7 });
    vi.advanceTimersByTime(1_000); // reconnect backoff
    socket.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
    expect(socket.sent.some((m) => m.op === 6)).toBe(true);
    expect(socket.sent.filter((m) => m.op === 2).length).toBe(1); // only the first identify
    gw.stop();
  });
});
