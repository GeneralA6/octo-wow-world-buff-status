import { WebSocket } from "ws";
import { silentLogger, type Logger } from "../logger.js";

/**
 * A minimal Discord gateway client — just enough to receive DMs the bot is sent,
 * so a player can link by DMing a code (link flow A). Hand-rolled over `ws` in the
 * same spirit as the WoW client rather than pulling in discord.js.
 *
 * Flow: connect → HELLO (op 10) starts the heartbeat → IDENTIFY (op 2) with the
 * DIRECT_MESSAGES + MESSAGE_CONTENT intents → READY captures the session → DM
 * MESSAGE_CREATE events are dispatched. Missing heartbeat ACKs, op 7 RECONNECT,
 * op 9 INVALID_SESSION and socket closes all reconnect (resuming when possible).
 *
 * MESSAGE_CONTENT is a privileged intent (free under 100 servers); without it the
 * DM `content` arrives empty and flow A can't read the code.
 */

// DIRECT_MESSAGES (1<<12) | MESSAGE_CONTENT (1<<15)
const INTENTS = (1 << 12) | (1 << 15);
const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const MAX_BACKOFF_MS = 30_000;

export interface GatewaySocket {
  send(data: string): void;
  close(code?: number): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
  onError(cb: (error: Error) => void): void;
}

export type SocketFactory = (url: string) => GatewaySocket;

export interface DiscordGatewayOptions {
  readonly token: string;
  /** Called with (authorId, content) for each DM the bot receives. */
  readonly onDirectMessage: (authorId: string, content: string) => void;
  readonly logger?: Logger;
  /** Test seam: how to open a socket. Defaults to a real `ws` connection. */
  readonly connect?: SocketFactory;
}

const defaultConnect: SocketFactory = (url) => {
  const ws = new WebSocket(url);
  return {
    send: (data) => ws.send(data),
    close: (code) => ws.close(code),
    onOpen: (cb) => ws.on("open", cb),
    onMessage: (cb) => ws.on("message", (data) => cb(data.toString())),
    onClose: (cb) => ws.on("close", () => cb()),
    onError: (cb) => ws.on("error", cb),
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numField(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" ? v : null;
}
function strField(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" ? v : null;
}
function recField(o: Record<string, unknown>, k: string): Record<string, unknown> | null {
  const v = o[k];
  return isRecord(v) ? v : null;
}

export class DiscordGateway {
  readonly #token: string;
  readonly #onDm: (authorId: string, content: string) => void;
  readonly #logger: Logger;
  readonly #connect: SocketFactory;

  #socket: GatewaySocket | null = null;
  #seq: number | null = null;
  #sessionId: string | null = null;
  #resumeUrl: string | null = null;
  #botUserId: string | null = null;
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #heartbeatAcked = true;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #backoffMs = 1_000;
  #stopped = false;

  constructor(options: DiscordGatewayOptions) {
    this.#token = options.token;
    this.#onDm = options.onDirectMessage;
    this.#logger = options.logger ?? silentLogger;
    this.#connect = options.connect ?? defaultConnect;
  }

  start(): void {
    this.#stopped = false;
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#heartbeatTimer = null;
    this.#reconnectTimer = null;
    this.#socket?.close();
    this.#socket = null;
  }

  #open(): void {
    const url =
      this.#sessionId && this.#resumeUrl ? `${this.#resumeUrl}?v=10&encoding=json` : GATEWAY_URL;
    const socket = this.#connect(url);
    this.#socket = socket;
    socket.onOpen(() => this.#logger.debug("discord gateway: socket open"));
    socket.onMessage((data) => this.#onMessage(data));
    socket.onClose(() => this.#onClose());
    socket.onError((error) => this.#logger.debug(`discord gateway error: ${error.message}`));
  }

  #onMessage(raw: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(payload)) return;

    const s = numField(payload, "s");
    if (s !== null) this.#seq = s;
    const op = numField(payload, "op");
    const data = payload.d;

    switch (op) {
      case 10: {
        const interval = isRecord(data) ? numField(data, "heartbeat_interval") : null;
        if (interval) this.#startHeartbeat(interval);
        if (this.#sessionId && this.#seq !== null) this.#resume();
        else this.#identify();
        break;
      }
      case 0:
        this.#onDispatch(strField(payload, "t"), recField(payload, "d"));
        break;
      case 1: // server asked for a heartbeat now
        this.#sendHeartbeat();
        break;
      case 11: // heartbeat ACK
        this.#heartbeatAcked = true;
        break;
      case 7: // RECONNECT — reconnect and resume
        this.#logger.debug("discord gateway: server asked to reconnect");
        this.#socket?.close();
        break;
      case 9: // INVALID_SESSION — resumable only if d === true
        if (data !== true) {
          this.#sessionId = null;
          this.#resumeUrl = null;
        }
        this.#socket?.close();
        break;
      default:
        break;
    }
  }

  #onDispatch(type: string | null, data: Record<string, unknown> | null): void {
    if (type === "READY" && data) {
      this.#sessionId = strField(data, "session_id");
      this.#resumeUrl = strField(data, "resume_gateway_url");
      const user = recField(data, "user");
      this.#botUserId = user ? strField(user, "id") : null;
      this.#backoffMs = 1_000;
      this.#logger.info("discord gateway: ready");
    } else if (type === "RESUMED") {
      this.#backoffMs = 1_000;
      this.#logger.debug("discord gateway: resumed");
    } else if (type === "MESSAGE_CREATE" && data) {
      this.#onMessageCreate(data);
    }
  }

  #onMessageCreate(data: Record<string, unknown>): void {
    if (strField(data, "guild_id")) return; // a guild message, not a DM
    const author = recField(data, "author");
    const authorId = author ? strField(author, "id") : null;
    if (!authorId || authorId === this.#botUserId) return; // ignore our own echoes
    if (author && author.bot === true) return; // ignore other bots
    const content = strField(data, "content") ?? "";
    if (content.trim().length === 0) return;
    this.#onDm(authorId, content);
  }

  #identify(): void {
    this.#send({
      op: 2,
      d: {
        token: this.#token,
        intents: INTENTS,
        properties: { os: "linux", browser: "turtle-onyxia-bot", device: "turtle-onyxia-bot" },
      },
    });
  }

  #resume(): void {
    this.#send({ op: 6, d: { token: this.#token, session_id: this.#sessionId, seq: this.#seq } });
  }

  #startHeartbeat(intervalMs: number): void {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatAcked = true;
    this.#heartbeatTimer = setInterval(() => {
      if (!this.#heartbeatAcked) {
        this.#logger.warn("discord gateway: no heartbeat ack, reconnecting");
        this.#socket?.close();
        return;
      }
      this.#heartbeatAcked = false;
      this.#sendHeartbeat();
    }, intervalMs);
    this.#heartbeatTimer.unref?.();
  }

  #sendHeartbeat(): void {
    this.#send({ op: 1, d: this.#seq });
  }

  #send(payload: unknown): void {
    try {
      this.#socket?.send(JSON.stringify(payload));
    } catch (error) {
      this.#logger.debug(
        `discord gateway: send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #onClose(): void {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
    if (this.#stopped) return;
    const delay = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, MAX_BACKOFF_MS);
    this.#reconnectTimer = setTimeout(() => this.#open(), delay);
    this.#reconnectTimer.unref?.();
  }
}
