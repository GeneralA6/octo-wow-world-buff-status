import { EventEmitter } from "node:events";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { VanillaHeaderCrypt } from "../crypto/header-crypt.js";
import { AUTH_OK, ChatType, WorldOpcode } from "../protocol/opcodes.js";
import type { WhoResult } from "../protocol/who.js";
import { PacketReader, PacketWriter } from "./byte-buffer.js";
import type { NodeSocketLike } from "./socket.js";
import { WorldClient } from "./world-client.js";

const SESSION_KEY = Buffer.from(Array.from({ length: 40 }, (_, i) => (i * 7 + 1) & 0xff));

/** One character record: guid + name + 150 skipped bytes. */
function charRecord(guid: bigint, name: string): Buffer {
  return new PacketWriter().u64LE(guid).cString(name).bytes(Buffer.alloc(150)).toBuffer();
}

function whoResponseBody(players: { name: string; area: number }[]): Buffer {
  const writer = new PacketWriter().u32LE(players.length).u32LE(players.length);
  for (const p of players) {
    writer.cString(p.name).cString("Guild").u32LE(60).u32LE(1).u32LE(2).u32LE(p.area);
  }
  return writer.toBuffer();
}

/**
 * A mock server socket that speaks the real world protocol: it decrypts the
 * client's CMSG headers (enabling its cipher right after CMSG_AUTH_SESSION, as a
 * real server does) and encrypts its SMSG replies. The client writes one full
 * frame per call, so each write carries exactly one frame.
 */
class MockServerSocket extends EventEmitter implements NodeSocketLike {
  #serverCrypt: VanillaHeaderCrypt | null = null;
  readonly #characters: { guid: bigint; name: string }[];
  readonly #names = new Map<bigint, string>();
  readonly sentWhispers: { target: string; message: string }[] = [];
  readonly standStates: number[] = [];
  readonly gameObjUses: bigint[] = [];
  readonly guildInvites: string[] = [];

  constructor(characters: { guid: bigint; name: string }[]) {
    super();
    this.#characters = characters;
  }

  /** Teach the mock a guid→name mapping for name-query replies. */
  setName(guid: bigint, name: string): void {
    this.#names.set(guid, name);
  }

  /** Deliver an incoming whisper from `senderGuid` to the client. */
  pushWhisper(senderGuid: bigint, text: string): void {
    const msg = Buffer.from(text, "utf8");
    const body = new PacketWriter()
      .u8(ChatType.Whisper)
      .u32LE(7)
      .u64LE(senderGuid)
      .u32LE(msg.length + 1)
      .bytes(msg)
      .u8(0)
      .u8(0)
      .toBuffer();
    this.#sendServer(WorldOpcode.SMSG_MESSAGECHAT, body);
  }

  /** Deliver a server SYSTEM message (how command results/errors arrive) to the client. */
  pushSystem(text: string): void {
    const msg = Buffer.from(text, "utf8");
    const body = new PacketWriter()
      .u8(ChatType.System)
      .u32LE(0)
      .u64LE(0n) // system messages carry no sender
      .u32LE(msg.length + 1)
      .bytes(msg)
      .u8(0)
      .u8(0)
      .toBuffer();
    this.#sendServer(WorldOpcode.SMSG_MESSAGECHAT, body);
  }

  /** Deliver a zone monster yell (the buff yell arrives this way) to the client. */
  pushMonsterYell(senderGuid: bigint, senderName: string, text: string): void {
    const name = Buffer.from(senderName, "utf8");
    const msg = Buffer.from(text, "utf8");
    const body = new PacketWriter()
      .u8(ChatType.MonsterYell)
      .u32LE(0)
      .u64LE(senderGuid)
      .u32LE(name.length + 1)
      .bytes(name)
      .u8(0)
      .u64LE(0n) // target guid
      .u32LE(msg.length + 1)
      .bytes(msg)
      .u8(0)
      .u8(0) // chat tag
      .toBuffer();
    this.#sendServer(WorldOpcode.SMSG_MESSAGECHAT, body);
  }

  /** Deliver a zlib-compressed object update (the login form) to the client. */
  pushCompressedObjects(raw: Buffer): void {
    const deflated = deflateSync(raw);
    const body = new PacketWriter().u32LE(raw.length).bytes(deflated).toBuffer();
    this.#sendServer(WorldOpcode.SMSG_COMPRESSED_UPDATE_OBJECT, body);
  }

  /** Tell the client a whisper target is offline. */
  pushPlayerNotFound(name: string): void {
    this.#sendServer(
      WorldOpcode.SMSG_CHAT_PLAYER_NOT_FOUND,
      new PacketWriter().cString(name).toBuffer(),
    );
  }

  /** Kick off the session the way a real server does: it speaks first. */
  begin(serverSeed: number): void {
    this.#sendServer(
      WorldOpcode.SMSG_AUTH_CHALLENGE,
      new PacketWriter().u32LE(serverSeed).toBuffer(),
    );
  }

  write(data: Buffer): boolean {
    const header = Buffer.from(data.subarray(0, 6));
    if (this.#serverCrypt) this.#serverCrypt.decryptRecv(header);
    const size = header.readUInt16BE(0);
    const opcode = header.readUInt32LE(2);
    const body = Buffer.from(data.subarray(6, 6 + (size - 4)));

    // The server enables its cipher immediately after the (plaintext) auth session.
    if (opcode === WorldOpcode.CMSG_AUTH_SESSION) {
      this.#serverCrypt = new VanillaHeaderCrypt(SESSION_KEY);
    }
    if (opcode === WorldOpcode.CMSG_MESSAGECHAT) {
      const reader = new PacketReader(body);
      reader.u32LE(); // type
      reader.u32LE(); // language
      this.sentWhispers.push({ target: reader.cString(), message: reader.cString() });
    }
    if (opcode === WorldOpcode.CMSG_STANDSTATECHANGE) {
      this.standStates.push(new PacketReader(body).u32LE());
    }
    if (opcode === WorldOpcode.CMSG_GAMEOBJ_USE) {
      this.gameObjUses.push(new PacketReader(body).u64LE());
    }
    if (opcode === WorldOpcode.CMSG_GUILD_INVITE) {
      this.guildInvites.push(new PacketReader(body).cString());
    }
    this.#respond(opcode, body);
    return true;
  }

  destroy(): void {
    queueMicrotask(() => this.emit("close"));
  }

  #respond(opcode: number, body: Buffer): void {
    switch (opcode) {
      case WorldOpcode.CMSG_AUTH_SESSION:
        this.#sendServer(WorldOpcode.SMSG_AUTH_RESPONSE, Buffer.from([AUTH_OK]));
        break;
      case WorldOpcode.CMSG_NAME_QUERY: {
        const guid = new PacketReader(body).u64LE();
        const name = this.#names.get(guid) ?? "Unknown";
        this.#sendServer(
          WorldOpcode.SMSG_NAME_QUERY_RESPONSE,
          new PacketWriter().u64LE(guid).cString(name).cString("").u32LE(1).u32LE(0).u32LE(1).toBuffer(),
        );
        break;
      }
      case WorldOpcode.CMSG_CHAR_ENUM: {
        const writer = new PacketWriter().u8(this.#characters.length);
        for (const character of this.#characters) {
          writer.bytes(charRecord(character.guid, character.name));
        }
        this.#sendServer(WorldOpcode.SMSG_CHAR_ENUM, writer.toBuffer());
        break;
      }
      case WorldOpcode.CMSG_PLAYER_LOGIN:
        this.#sendServer(WorldOpcode.SMSG_LOGIN_VERIFY_WORLD, Buffer.alloc(20));
        break;
      case WorldOpcode.CMSG_WHO:
        this.#sendServer(
          WorldOpcode.SMSG_WHO,
          whoResponseBody([
            { name: "Onytank", area: 2159 },
            { name: "Healbot", area: 2159 },
          ]),
        );
        break;
      default:
        break;
    }
  }

  #sendServer(opcode: number, body: Buffer): void {
    const header = new PacketWriter().u16BE(body.length + 2).u16LE(opcode).toBuffer();
    if (this.#serverCrypt) this.#serverCrypt.encryptSend(header);
    const frame = Buffer.concat([header, body]);
    queueMicrotask(() => this.emit("data", frame));
  }
}

function withTimeout<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

describe("WorldClient (against a scripted mock server)", () => {
  it("completes the handshake, reaches the world, and parses a /who reply", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);

    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    let deliverWho: (result: WhoResult) => void = () => {};
    const whoResult = new Promise<WhoResult>((resolve) => {
      deliverWho = resolve;
    });
    const errors: Error[] = [];

    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "botchar", // case-insensitive match
      clientSeed: 0x11223344,
      pingIntervalMs: 0,
      handlers: {
        onReady: () => markReady(),
        onWho: (result) => deliverWho(result),
        onError: (error) => errors.push(error),
      },
    });

    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);
    expect(client.isReady).toBe(true);

    client.requestWho({ zoneIds: [2159] });
    const result = await withTimeout(whoResult);

    expect(result.onlineCount).toBe(2);
    expect(result.players.map((p) => p.name)).toEqual(["Onytank", "Healbot"]);
    expect(result.players.every((p) => p.areaId === 2159)).toBe(true);
    expect(errors).toEqual([]);

    client.close();
  });

  it("errors clearly when the configured character is not on the account", async () => {
    const socket = new MockServerSocket([{ guid: 1n, name: "SomeoneElse" }]);

    let deliverError: (error: Error) => void = () => {};
    const errored = new Promise<Error>((resolve) => {
      deliverError = resolve;
    });

    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 1,
      pingIntervalMs: 0,
      handlers: { onError: (error) => deliverError(error) },
    });

    client.start();
    socket.begin(1);

    const error = await withTimeout(errored);
    expect(error.message).toContain('character "Botchar" not found');
    expect(error.message).toContain("SomeoneElse");
    expect(client.isReady).toBe(false);

    client.close();
  });

  it("resolves a whisper sender via name query and can whisper back", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);
    socket.setName(0x555n, "Raider");

    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    let deliverWhisper: (v: { sender: string; text: string }) => void = () => {};
    const whispered = new Promise<{ sender: string; text: string }>((resolve) => {
      deliverWhisper = resolve;
    });

    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 0x22,
      pingIntervalMs: 0,
      handlers: {
        onReady: () => markReady(),
        onWhisper: (sender, text) => deliverWhisper({ sender, text }),
      },
    });

    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);

    // The whisper carries only a guid; the client name-queries and then reports it.
    socket.pushWhisper(0x555n, "subscribe");
    expect(await withTimeout(whispered)).toEqual({ sender: "Raider", text: "subscribe" });

    client.whisper("Raider", "Subscribed!");
    expect(socket.sentWhispers).toContainEqual({ target: "Raider", message: "Subscribed!" });

    client.close();
  });

  it("surfaces a server SYSTEM message via onSystemMessage (trimmed), never as a whisper", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);
    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const system: string[] = [];
    const whispers: string[] = [];
    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 0x22,
      pingIntervalMs: 0,
      handlers: {
        onReady: () => markReady(),
        onSystemMessage: (text) => system.push(text),
        onWhisper: (_sender, text) => whispers.push(text),
      },
    });

    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);

    socket.pushSystem("  Raider is already in a guild.  ");
    await new Promise((resolve) => setImmediate(resolve));
    expect(system).toEqual(["Raider is already in a guild."]); // trimmed
    expect(whispers).toEqual([]); // a system message is never a command

    client.close();
  });

  it("sends a stand-state change (sit) once in world", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);

    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });

    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 0x55,
      pingIntervalMs: 0,
      handlers: { onReady: () => markReady() },
    });

    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);

    client.sit();
    expect(socket.standStates).toContain(1); // STAND_STATE_SIT

    client.close();
  });

  it("sends CMSG_GUILD_INVITE with the invitee name", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);
    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 0x88,
      pingIntervalMs: 0,
      handlers: { onReady: () => markReady() },
    });
    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);

    client.guildInvite("Raider");
    expect(socket.guildInvites).toContain("Raider");
    client.close();
  });

  it("sends CMSG_GAMEOBJ_USE with the target guid", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);
    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 0x66,
      pingIntervalMs: 0,
      handlers: { onReady: () => markReady() },
    });
    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);

    client.useGameObject(0x123456789an);
    expect(socket.gameObjUses).toContain(0x123456789an);
    client.close();
  });

  it("decompresses a compressed object update and hands over the raw block", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);
    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    let deliverObjects: (body: Buffer) => void = () => {};
    const objects = new Promise<Buffer>((resolve) => {
      deliverObjects = resolve;
    });
    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 0x77,
      pingIntervalMs: 0,
      handlers: { onReady: () => markReady(), onWorldObjects: (body) => deliverObjects(body) },
    });
    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);

    const payload = Buffer.from([1, 0, 0, 0, 5, 0xaa, 0xbb]); // arbitrary block bytes
    socket.pushCompressedObjects(payload);
    expect(await withTimeout(objects)).toEqual(payload);
    client.close();
  });

  it("routes a zone monster yell to onMonsterYell with name and text intact", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);

    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    let deliverYell: (v: { name: string; text: string }) => void = () => {};
    const yelled = new Promise<{ name: string; text: string }>((resolve) => {
      deliverYell = resolve;
    });

    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 0x44,
      pingIntervalMs: 0,
      handlers: {
        onReady: () => markReady(),
        onMonsterYell: (name, text) => deliverYell({ name, text }),
      },
    });

    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);

    const yell = "The dread lady, Onyxia, hangs from the arches!";
    socket.pushMonsterYell(0n, "Major Mattingly", yell);
    expect(await withTimeout(yelled)).toEqual({ name: "Major Mattingly", text: yell });

    client.close();
  });

  it("reports an undelivered whisper when the target is offline", async () => {
    const socket = new MockServerSocket([{ guid: 0xabcdn, name: "Botchar" }]);

    let markReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    let deliverUndelivered: (target: string) => void = () => {};
    const undelivered = new Promise<string>((resolve) => {
      deliverUndelivered = resolve;
    });

    const client = new WorldClient({
      socket,
      account: "BOTACCOUNT",
      sessionKey: SESSION_KEY,
      characterName: "Botchar",
      clientSeed: 0x33,
      pingIntervalMs: 0,
      handlers: {
        onReady: () => markReady(),
        onWhisperUndelivered: (target) => deliverUndelivered(target),
      },
    });

    client.start();
    socket.begin(0xdeadbeef);
    await withTimeout(ready);

    socket.pushPlayerNotFound("OfflineGuy");
    expect(await withTimeout(undelivered)).toBe("OfflineGuy");

    client.close();
  });
});
