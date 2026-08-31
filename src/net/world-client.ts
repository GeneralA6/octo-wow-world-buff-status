import { randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { VanillaHeaderCrypt } from "../crypto/header-crypt.js";
import { FatalError } from "../errors.js";
import { AUTH_OK, ChatType, CLIENT_BUILD, WorldOpcode } from "../protocol/opcodes.js";
import { buildWhoRequestBody, parseWhoResponseBody, type WhoQuery, type WhoResult } from "../protocol/who.js";
import {
  buildWhisper,
  isMonsterChatType,
  parseMonsterChat,
  parsePlayerNotFound,
  parseServerChat,
} from "../protocol/chat.js";
import { buildNameQuery, parseNameQueryResponse } from "../protocol/name-query.js";
import { silentLogger, type Logger } from "../logger.js";
import type { NodeSocketLike } from "./socket.js";
import {
  buildAuthSessionBody,
  buildGameObjUseBody,
  buildGuildInviteBody,
  buildPingBody,
  buildPlayerLoginBody,
  buildStandStateBody,
  buildWorldClientFrame,
  parseAuthChallenge,
  parseAuthResponse,
  parseCharEnum,
  readServerHeader,
  STAND_STATE_SIT,
  WORLD_CLIENT_HEADER_SIZE,
  WORLD_SERVER_HEADER_SIZE,
} from "./world-packets.js";

export interface WorldClientHandlers {
  /** Character is in the world; /who can now be requested. */
  onReady?: () => void;
  onWho?: (result: WhoResult) => void;
  /** A player whispered the bot; `sender` is resolved to a character name. */
  onWhisper?: (sender: string, text: string) => void;
  /** A whisper we sent could not be delivered — the target is offline. */
  onWhisperUndelivered?: (target: string) => void;
  /** An NPC yelled to the zone (raw). The wiring layer decides if it is a buff yell. */
  onMonsterYell?: (senderName: string, text: string) => void;
  /** A decompressed nearby-object update block, for parsing GameObjects (e.g. a bench). */
  onWorldObjects?: (body: Buffer) => void;
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
  /** Resolver for an in-flight whoOnce() — one /who at a time, so replies are in order. */
  #whoPending: {
    resolve: (result: WhoResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
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

  /**
   * Send one /who and resolve with its reply. Only one may be in flight — /who has
   * no correlation id, so the caller must await each before sending the next (used
   * to slice a query by class and merge, beating the 49-result cap).
   */
  whoOnce(query: WhoQuery, timeoutMs = 8_000): Promise<WhoResult> {
    if (!this.#ready) return Promise.reject(new Error("cannot /who before the character is in world"));
    if (this.#whoPending) return Promise.reject(new Error("a /who is already in flight"));
    return new Promise<WhoResult>((resolve, reject) => {
      const started = Date.now();
      const timer = setTimeout(() => {
        this.#whoPending = null;
        reject(new Error(`/who timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      // Surface the round-trip so a creep toward the timeout is visible BEFORE it starts
      // failing — under peak load /who slows down, and a silent timeout hides why.
      const timedResolve = (result: WhoResult): void => {
        const elapsed = Date.now() - started;
        if (elapsed > timeoutMs / 2) this.#logger.warn(`/who slow: ${elapsed}ms (timeout ${timeoutMs}ms)`);
        else this.#logger.debug(`/who replied in ${elapsed}ms`);
        resolve(result);
      };
      this.#whoPending = { resolve: timedResolve, reject, timer };
      this.#send(WorldOpcode.CMSG_WHO, buildWhoRequestBody(query));
    });
  }

  #rejectWho(reason: string): void {
    if (!this.#whoPending) return;
    clearTimeout(this.#whoPending.timer);
    const { reject } = this.#whoPending;
    this.#whoPending = null;
    reject(new Error(reason));
  }

  /** Whisper a player by character name. */
  whisper(target: string, message: string): void {
    if (!this.#ready) throw new Error("cannot whisper before the character is in world");
    // INFO, not debug: an outgoing whisper is a message this character sent, and we
    // want it visible in the logs (the logger is per-character, so it's already tagged).
    this.#logger.info(`whisper -> ${target}: ${JSON.stringify(message)}`);
    this.#send(WorldOpcode.CMSG_MESSAGECHAT, buildWhisper(target, message));
  }

  /** Sit the character down (the /sit stand-state) — used to look parked in a city. */
  sit(): void {
    if (!this.#ready) throw new Error("cannot sit before the character is in world");
    this.#logger.debug("world: /sit");
    this.#send(WorldOpcode.CMSG_STANDSTATECHANGE, buildStandStateBody(STAND_STATE_SIT));
  }

  /** Use/interact with a GameObject by guid (e.g. sit on a bench). */
  useGameObject(guid: bigint): void {
    if (!this.#ready) throw new Error("cannot use a game object before the character is in world");
    this.#logger.debug(`world: use gameobject 0x${guid.toString(16)}`);
    this.#send(WorldOpcode.CMSG_GAMEOBJ_USE, buildGameObjUseBody(guid));
  }

  /** Invite a player to the guild by character name (no-op server-side if not guilded). */
  guildInvite(name: string): void {
    if (!this.#ready) throw new Error("cannot guild-invite before the character is in world");
    this.#logger.debug(`world: guild invite -> ${name}`);
    this.#send(WorldOpcode.CMSG_GUILD_INVITE, buildGuildInviteBody(name));
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
    this.#rejectWho("world connection closed");
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
        case WorldOpcode.SMSG_WHO: {
          const result = parseWhoResponseBody(body);
          if (this.#whoPending) {
            clearTimeout(this.#whoPending.timer);
            const { resolve } = this.#whoPending;
            this.#whoPending = null;
            resolve(result);
          } else {
            this.#handlers.onWho?.(result);
          }
          break;
        }
        case WorldOpcode.SMSG_MESSAGECHAT:
          this.#handleChat(body);
          break;
        case WorldOpcode.SMSG_UPDATE_OBJECT:
          this.#handleWorldObjects(body, false);
          break;
        case WorldOpcode.SMSG_COMPRESSED_UPDATE_OBJECT:
          this.#handleWorldObjects(body, true);
          break;
        case WorldOpcode.SMSG_NAME_QUERY_RESPONSE:
          this.#handleNameQueryResponse(body);
          break;
        case WorldOpcode.SMSG_CHAT_PLAYER_NOT_FOUND:
          this.#handlePlayerNotFound(body);
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
    this.#logger.debug(`world: chat recv [${body.subarray(0, 80).toString("hex")}]`);
    try {
      if (body.length > 0 && isMonsterChatType(body.readUInt8(0))) {
        this.#handleMonsterChat(body);
        return;
      }
      const chat = parseServerChat(body);
      this.#logger.debug(
        `world: chat type=0x${chat.type.toString(16)} guid=0x${chat.senderGuid.toString(16)} text=${JSON.stringify(chat.text)}`,
      );
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

  #handleMonsterChat(body: Buffer): void {
    try {
      const chat = parseMonsterChat(body);
      // Log every monster yell so the live buff-yell text can be captured/confirmed.
      this.#logger.debug(
        `world: monster chat from ${JSON.stringify(chat.senderName)}: ${JSON.stringify(chat.text)}`,
      );
      if (chat.type === ChatType.MonsterYell) this.#handlers.onMonsterYell?.(chat.senderName, chat.text);
    } catch (error) {
      this.#logger.debug(
        `world: could not read monster chat [${body.subarray(0, 64).toString("hex")}]: ${(error as Error).message}`,
      );
    }
  }

  #handleWorldObjects(body: Buffer, compressed: boolean): void {
    try {
      // Compressed form: a u32 uncompressed size then a zlib stream.
      const raw = compressed ? inflateSync(body.subarray(4)) : body;
      this.#logger.debug(`world: object update (${raw.length}b${compressed ? ", was compressed" : ""})`);
      this.#handlers.onWorldObjects?.(raw);
    } catch (error) {
      this.#logger.debug(`world: could not read object update: ${(error as Error).message}`);
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

  #handlePlayerNotFound(body: Buffer): void {
    try {
      this.#handlers.onWhisperUndelivered?.(parsePlayerNotFound(body));
    } catch (error) {
      this.#logger.debug(`world: could not read player-not-found: ${(error as Error).message}`);
    }
  }

  #sendPing(): void {
    this.#pingSequence += 1;
    this.#send(WorldOpcode.CMSG_PING, buildPingBody(this.#pingSequence, 0));
  }
}
