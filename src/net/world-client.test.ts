import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { VanillaHeaderCrypt } from "../crypto/header-crypt.js";
import { AUTH_OK, WorldOpcode } from "../protocol/opcodes.js";
import type { WhoResult } from "../protocol/who.js";
import { PacketWriter } from "./byte-buffer.js";
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

  constructor(characters: { guid: bigint; name: string }[]) {
    super();
    this.#characters = characters;
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
    this.#respond(opcode);
    return true;
  }

  destroy(): void {
    queueMicrotask(() => this.emit("close"));
  }

  #respond(opcode: number): void {
    switch (opcode) {
      case WorldOpcode.CMSG_AUTH_SESSION:
        this.#sendServer(WorldOpcode.SMSG_AUTH_RESPONSE, Buffer.from([AUTH_OK]));
        break;
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
});
