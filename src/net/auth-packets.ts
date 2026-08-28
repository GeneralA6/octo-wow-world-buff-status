import { PacketReader, PacketWriter } from "./byte-buffer.js";
import {
  AuthCommand,
  CLIENT_BUILD,
  CLIENT_VERSION,
  LogonResult,
} from "../protocol/opcodes.js";

/**
 * Auth (logon) server packet builders and parsers.
 *
 * The logon server has no length-prefixed framing except for the realm list;
 * each message is an opcode byte followed by a known structure. These functions
 * are pure so the wire format is pinned by tests; the socket client drives them.
 *
 * The four fixed 4-byte strings are stored the way the 1.12 client sends them on
 * the wire: the game name "WoW\0" forward, and platform/os/locale reversed.
 */

const GAME_NAME = Buffer.from([0x57, 0x6f, 0x57, 0x00]); // "WoW\0"
const PLATFORM = Buffer.from([0x36, 0x38, 0x78, 0x00]); // "x86" reversed -> "68x\0"
const OS = Buffer.from([0x6e, 0x69, 0x57, 0x00]); // "Win" reversed -> "niW\0"
const LOCALE = Buffer.from([0x53, 0x55, 0x6e, 0x65]); // "enUS" reversed -> "SUne"

// The byte after the opcode. MaNGOS-family cores ignore it; 8 is what modern
// references send.
const PROTOCOL_VERSION = 8;

export function buildLogonChallenge(username: string): Buffer {
  const accountBytes = Buffer.from(username.toUpperCase(), "utf8");
  if (accountBytes.length === 0 || accountBytes.length > 0xff) {
    throw new RangeError("account name must be 1..255 bytes");
  }

  const rest = new PacketWriter()
    .bytes(GAME_NAME)
    .u8(CLIENT_VERSION.major)
    .u8(CLIENT_VERSION.minor)
    .u8(CLIENT_VERSION.patch)
    .u16LE(CLIENT_BUILD)
    .bytes(PLATFORM)
    .bytes(OS)
    .bytes(LOCALE)
    .i32LE(0) // timezone bias
    .bytes(Buffer.from([127, 0, 0, 1])) // client ip (big-endian octets)
    .u8(accountBytes.length)
    .bytes(accountBytes)
    .toBuffer();

  return new PacketWriter()
    .u8(AuthCommand.LogonChallenge)
    .u8(PROTOCOL_VERSION)
    .u16LE(rest.length)
    .bytes(rest)
    .toBuffer();
}

export function buildLogonProof(clientPublicKey: Buffer, clientProof: Buffer): Buffer {
  if (clientPublicKey.length !== 32) throw new RangeError("A must be 32 bytes");
  if (clientProof.length !== 20) throw new RangeError("M1 must be 20 bytes");
  return new PacketWriter()
    .u8(AuthCommand.LogonProof)
    .bytes(clientPublicKey)
    .bytes(clientProof)
    .bytes(Buffer.alloc(20)) // crc_hash — unused, zeroed
    .u8(0) // number of telemetry keys
    .u8(0) // security flags
    .toBuffer();
}

export function buildRealmListRequest(): Buffer {
  return new PacketWriter().u8(AuthCommand.RealmList).u32LE(0).toBuffer();
}

export interface LogonChallengeServer {
  readonly result: number;
  readonly serverPublicKey?: Buffer; // B, 32-byte LE
  readonly generator?: Buffer; // g
  readonly largeSafePrime?: Buffer; // N, LE
  readonly salt?: Buffer; // 32 bytes
}

export function parseLogonChallengeServer(buf: Buffer): LogonChallengeServer {
  const reader = new PacketReader(buf);
  const opcode = reader.u8();
  if (opcode !== AuthCommand.LogonChallenge) {
    throw new Error(`expected LogonChallenge opcode, got 0x${opcode.toString(16)}`);
  }
  reader.u8(); // protocol/unknown, ignored
  const result = reader.u8();
  if (result !== LogonResult.Success) return { result };

  const serverPublicKey = reader.bytes(32);
  const generator = reader.bytes(reader.u8());
  const largeSafePrime = reader.bytes(reader.u8());
  const salt = reader.bytes(32);
  return { result, serverPublicKey, generator, largeSafePrime, salt };
}

export interface LogonProofServer {
  readonly result: number;
  readonly serverProof?: Buffer; // M2, 20 bytes
}

export function parseLogonProofServer(buf: Buffer): LogonProofServer {
  const reader = new PacketReader(buf);
  const opcode = reader.u8();
  if (opcode !== AuthCommand.LogonProof) {
    throw new Error(`expected LogonProof opcode, got 0x${opcode.toString(16)}`);
  }
  const result = reader.u8();
  if (result !== LogonResult.Success) return { result };
  const serverProof = reader.bytes(20);
  return { result, serverProof };
}

export interface RealmEntry {
  readonly name: string;
  /** "host:port" as advertised by the realm list. */
  readonly address: string;
}

/** Parse the realm-list payload (the bytes after the opcode + u16 size header). */
export function parseRealmList(payload: Buffer): RealmEntry[] {
  const reader = new PacketReader(payload);
  reader.u32LE(); // unknown (0)
  const count = reader.u8(); // vanilla uses a single-byte realm count

  const realms: RealmEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    reader.u32LE(); // realm type / icon
    reader.u8(); // realm flags / colour
    const name = reader.cString();
    const address = reader.cString();
    reader.f32LE(); // population
    reader.u8(); // character count
    reader.u8(); // timezone
    reader.u8(); // realm id
    realms.push({ name, address });
  }
  return realms;
}
