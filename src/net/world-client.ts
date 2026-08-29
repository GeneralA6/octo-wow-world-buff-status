import { randomBytes } from "node:crypto";
import { VanillaHeaderCrypt } from "../crypto/header-crypt.js";
import { FatalError } from "../errors.js";
import { AUTH_OK, ChatType, CLIENT_BUILD, WorldOpcode } from "../protocol/opcodes.js";
import { buildWhoRequestBody, parseWhoResponseBody, type WhoQuery, type WhoResult } from "../protocol/who.js";
import { buildWhisper, parseServerChat } from "../protocol/chat.js";
import { buildNameQuery, parseNameQueryResponse } from "../protocol/name-query.js";
import { silentLogger, type Logger } from "../logger.js";
import type { NodeSocketLike } from "./socket.js";
import {
  buildAuthSessionBody,
  buildPingBody,
  buildPlayerLoginBody,
  buildWorldClientFrame,
  parseAuthChallenge,
  parseAuthResponse,
  parseCharEnum,
  readServerHeader,
  WORLD_CLIENT_HEADER_SIZE,
  WORLD_SERVER_HEADER_SIZE,
} from "./world-packets.js";

export interface WorldClientHandlers {
  /** Character is in the world; /who can now be requested. */
  onReady?: () => void;
  onWho?: (result: WhoResult) => void;
  /** A player whispered the bot; `sender` is resolved to a character name. */
  onWhisper?: (sender: string, text: string) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  /** Server sent warden data — anticheat is active and unhandled. */
  onWarden?: () => void;
}

export interface WorldClientOptions {
  readonly socket: NodeSocketLike;
  readonly account: string;
  readonly sessionKey: Buffer;
  readonly characterName: string;
  readonly handlers?: WorldClientHandlers;
  readonly logger?: Logger;
  /** Ping interval once in world; 0 disables. Default 30s. */
  readonly pingIntervalMs?: number;
  /** Test seam: fixed 4-byte client seed. Defaults to secure random. */
  readonly clientSeed?: number;
  /** Client build for the world auth session. Defaults to CLIENT_BUILD. */
  readonly build?: number;
}

/**
 * Drives the world-server session: auth handshake, character login, keep-alive
 * pings, and /who requests. Feeds on a socket-like injected by the caller, so a
 * scripted mock server exercises the whole state machine in tests.
 */
export class WorldClient {
  readonly #socket: NodeSocketLike;
  readonly #account: string;
  readonly #sessionKey: Buffer;
  readonly #characterName: string;
  readonly #handlers: WorldClientHandlers;
  readonly #logger: Logger;
  readonly #pingIntervalMs: number;
  readonly #clientSeed: number;
  readonly #build: number;

  #crypt: VanillaHeaderCrypt | null = null;
  #recvBuffer = Buffer.alloc(0);
  #pendingHeader: { opcode: number; bodyLength: number } | null = null;
  #ready = false;
  #closed = false;
  #pingTimer: NodeJS.Timeout | null = null;
  #pingSequence = 0;
  /** Resolved sender names, and whispers held while a name query is in flight. */
  readonly #nameCache = new Map<bigint, string>();
  readonly #pendingWhispers = new Map<bigint, string[]>();

  constructor(options: WorldClientOptions) {
    this.#socket = options.socket;
    this.#account = options.account;
    this.#sessionKey = options.sessionKey;
    this.#characterName = options.characterName;
    this.#handlers = options.handlers ?? {};
    this.#logger = options.logger ?? silentLogger;
    this.#pingIntervalMs = options.pingIntervalMs ?? 30_000;
    this.#clientSeed = options.clientSeed ?? randomBytes(4).readUInt32LE(0);
    this.#build = options.build ?? CLIENT_BUILD;
  }

  get isReady(): boolean {
    return this.#ready;
  }

  /** Attach socket listeners; the server speaks first with SMSG_AUTH_CHALLENGE. */
  start(): void {
    this.#socket.on("data", (chunk: Buffer) => this.#onData(chunk));
    this.#socket.on("error", (error: Error) => this.#handlers.onError?.(error));
    this.#socket.on("close", () => this.#onClose());
  }

  requestWho(query: WhoQuery): void {
    if (!this.#ready) throw new Error("cannot /who before the character is in world");
    this.#send(WorldOpcode.CMSG_WHO, buildWhoRequestBody(query));
  }

  /** Whisper a player by character name. */
  whisper(target: string, message: string): void {
    if (!this.#ready) throw new Error("cannot whisper before the character is in world");
    this.#send(WorldOpcode.CMSG_MESSAGECHAT, buildWhisper(target, message));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
    this.#socket.destroy();
  }

  #onClose(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
    if (!this.#closed) {
      this.#closed = true;
      this.#handlers.onClose?.();
    }
  }

  #send(opcode: number, body: Buffer): void {
    const frame = buildWorldClientFrame(opcode, body);
    if (this.#crypt) this.#crypt.encryptSend(frame.subarray(0, WORLD_CLIENT_HEADER_SIZE));
    this.#socket.write(frame);
  }

  #onData(chunk: Buffer): void {
    this.#recvBuffer = Buffer.concat([this.#recvBuffer, chunk]);

    for (;;) {
      if (!this.#pendingHeader) {
        if (this.#recvBuffer.length < WORLD_SERVER_HEADER_SIZE) break;
        const header = Buffer.from(this.#recvBuffer.subarray(0, WORLD_SERVER_HEADER_SIZE));
        if (this.#crypt) this.#crypt.decryptRecv(header);
        this.#pendingHeader = readServerHeader(header);
        this.#recvBuffer = this.#recvBuffer.subarray(WORLD_SERVER_HEADER_SIZE);
      }

      if (this.#recvBuffer.length < this.#pendingHeader.bodyLength) break;
      const { opcode, bodyLength } = this.#pendingHeader;
      const body = Buffer.from(this.#recvBuffer.subarray(0, bodyLength));
      this.#recvBuffer = this.#recvBuffer.subarray(bodyLength);
      this.#pendingHeader = null;
      this.#dispatch(opcode, body);
    }
  }

  #dispatch(opcode: number, body: Buffer): void {
    try {
      switch (opcode) {
        case WorldOpcode.SMSG_AUTH_CHALLENGE:
          this.#handleAuthChallenge(body);
          break;
        case WorldOpcode.SMSG_AUTH_RESPONSE:
          this.#handleAuthResponse(body);
          break;
        case WorldOpcode.SMSG_CHAR_ENUM:
          this.#handleCharEnum(body);
          break;
        case WorldOpcode.SMSG_LOGIN_VERIFY_WORLD:
          this.#handleInWorld();
          break;
        case WorldOpcode.SMSG_WHO:
          this.#handlers.onWho?.(parseWhoResponseBody(body));
          break;
        case WorldOpcode.SMSG_MESSAGECHAT:
          this.#handleChat(body);
          break;
        case WorldOpcode.SMSG_NAME_QUERY_RESPONSE:
          this.#handleNameQueryResponse(body);
          break;
        case WorldOpcode.SMSG_PONG:
          break;
        case WorldOpcode.SMSG_WARDEN_DATA:
          this.#logger.warn("world: server sent warden data (anticheat active, unhandled)");
          this.#handlers.onWarden?.();
          break;
        default:
          this.#logger.debug(`world: ignoring opcode 0x${opcode.toString(16)}`);
      }
    } catch (error) {
      this.#handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  #handleAuthChallenge(body: Buffer): void {
    const { serverSeed } = parseAuthChallenge(body);
    this.#logger.debug("world: got auth challenge, sending session");
    // Auth session is sent in plaintext; encryption starts immediately after.
    this.#send(
      WorldOpcode.CMSG_AUTH_SESSION,
      buildAuthSessionBody(this.#account, this.#clientSeed, serverSeed, this.#sessionKey, this.#build),
    );
    this.#crypt = new VanillaHeaderCrypt(this.#sessionKey);
  }

  #handleAuthResponse(body: Buffer): void {
    const { result } = parseAuthResponse(body);
    if (result !== AUTH_OK) {
      throw new Error(`world: auth response rejected (code 0x${result.toString(16)})`);
    }
    this.#logger.debug("world: authenticated, requesting character list");
    this.#send(WorldOpcode.CMSG_CHAR_ENUM, Buffer.alloc(0));
  }

  #handleCharEnum(body: Buffer): void {
    const characters = parseCharEnum(body);
    const wanted = this.#characterName.toLowerCase();
    const match = characters.find((entry) => entry.name.toLowerCase() === wanted);
    if (!match) {
      const names = characters.map((entry) => entry.name).join(", ") || "(none)";
      throw new FatalError(
        `world: character "${this.#characterName}" not found. Available: ${names}`,
      );
    }
    this.#logger.debug(`world: logging in character ${match.name}`);
    this.#send(WorldOpcode.CMSG_PLAYER_LOGIN, buildPlayerLoginBody(match.guid));
  }

  #handleInWorld(): void {
    if (this.#ready) return;
    this.#ready = true;
    this.#logger.info("world: character is in world");
    if (this.#pingIntervalMs > 0) {
      this.#pingTimer = setInterval(() => this.#sendPing(), this.#pingIntervalMs);
      this.#pingTimer.unref?.();
    }
    this.#handlers.onReady?.();
  }

  /**
   * A player whispered us. The packet carries only the sender's GUID, so if we
   * don't already know the name we hold the text and fire a name query, flushing
   * it when the response arrives. Parsing is guarded: a chat packet we can't read
   * is logged and dropped, never allowed to tear down the session.
   */
  #handleChat(body: Buffer): void {
    try {
      const chat = parseServerChat(body);
      if (chat.type !== ChatType.Whisper) return; // only inbound whispers are commands
      const text = chat.text.trim();
      if (!text) return;

      const known = this.#nameCache.get(chat.senderGuid);
      if (known) {
        this.#handlers.onWhisper?.(known, text);
        return;
      }
      const queued = this.#pendingWhispers.get(chat.senderGuid);
      if (queued) {
        queued.push(text); // a name query is already in flight for this sender
        return;
      }
      this.#pendingWhispers.set(chat.senderGuid, [text]);
      this.#send(WorldOpcode.CMSG_NAME_QUERY, buildNameQuery(chat.senderGuid));
    } catch (error) {
      this.#logger.debug(
        `world: could not read chat [${body.subarray(0, 64).toString("hex")}]: ${(error as Error).message}`,
      );
    }
  }

  #handleNameQueryResponse(body: Buffer): void {
    try {
      const { guid, name } = parseNameQueryResponse(body);
      this.#nameCache.set(guid, name);
      const queued = this.#pendingWhispers.get(guid);
      if (!queued) return;
      this.#pendingWhispers.delete(guid);
      for (const text of queued) this.#handlers.onWhisper?.(name, text);
    } catch (error) {
      this.#logger.debug(`world: could not read name-query response: ${(error as Error).message}`);
    }
  }

  #sendPing(): void {
    this.#pingSequence += 1;
    this.#send(WorldOpcode.CMSG_PING, buildPingBody(this.#pingSequence, 0));
  }
}
