import { PacketReader, PacketWriter } from "../net/byte-buffer.js";
import { ChatType, LANG_UNIVERSAL } from "./opcodes.js";

/**
 * Chat wire codecs for the whisper command interface.
 *
 * Outbound (CMSG_MESSAGECHAT) is well-defined; the inbound (SMSG_MESSAGECHAT)
 * player-message layout below is the documented 1.12 shape and MUST be confirmed
 * against a live capture (whisper the bot, dump the body) before it is trusted —
 * the same discipline used for the auth addon block and crc salt.
 *
 *   SMSG_MESSAGECHAT (player message):  u8 type, u32 language, u64 senderGuid,
 *                                       u32 msgLen (incl. null), msg, u8 chatTag
 *   SMSG_MESSAGECHAT (monster message): u8 type, u32 language, u64 senderGuid,
 *                                       u32 nameLen (incl. null), name, u64 targetGuid,
 *                                       u32 msgLen (incl. null), msg, u8 chatTag
 *   CMSG_MESSAGECHAT (whisper):         u32 type, u32 language, cstring to, cstring msg
 *
 * Monster messages (the city buff yell is one) carry the sender's name inline and a
 * target guid, so they have a DIFFERENT layout than player messages — feeding one to
 * `parseServerChat` would read the name length as the message length. This layout is
 * the documented 1.12 shape and MUST be confirmed against a live yell capture (the
 * world client debug-logs every monster message for exactly that).
 */

export interface IncomingChat {
  readonly type: number;
  readonly language: number;
  readonly senderGuid: bigint;
  readonly text: string;
}

/** Parse an SMSG_MESSAGECHAT player message. The caller gates on `type`. */
export function parseServerChat(body: Buffer): IncomingChat {
  const reader = new PacketReader(body);
  const type = reader.u8();
  const language = reader.u32LE();
  const senderGuid = reader.u64LE();
  const msgLen = reader.u32LE();
  const raw = reader.bytes(msgLen);
  const nul = raw.indexOf(0);
  const text = raw.toString("utf8", 0, nul === -1 ? raw.length : nul);
  return { type, language, senderGuid, text };
}

export interface MonsterChat {
  readonly type: number;
  readonly senderGuid: bigint;
  readonly senderName: string;
  readonly text: string;
}

const MONSTER_CHAT_TYPES: ReadonlySet<number> = new Set([
  ChatType.MonsterSay,
  ChatType.MonsterYell,
  ChatType.MonsterWhisper,
  ChatType.MonsterEmote,
]);

/** True if the chat type uses the monster layout (sender name inline). */
export function isMonsterChatType(type: number): boolean {
  return MONSTER_CHAT_TYPES.has(type);
}

/** Parse an SMSG_MESSAGECHAT monster message (name inline). Caller gates on `type`. */
export function parseMonsterChat(body: Buffer): MonsterChat {
  const reader = new PacketReader(body);
  const type = reader.u8();
  reader.u32LE(); // language
  const senderGuid = reader.u64LE();
  const nameRaw = reader.bytes(reader.u32LE());
  const nameNul = nameRaw.indexOf(0);
  const senderName = nameRaw.toString("utf8", 0, nameNul === -1 ? nameRaw.length : nameNul);
  reader.u64LE(); // target guid
  const msgRaw = reader.bytes(reader.u32LE());
  const msgNul = msgRaw.indexOf(0);
  const text = msgRaw.toString("utf8", 0, msgNul === -1 ? msgRaw.length : msgNul);
  return { type, senderGuid, senderName, text };
}

/**
 * WoW treats '|' as the chat escape/formatting prefix — colour codes (|cff...|r) and
 * hyperlinks (|Hitem:...|h) all begin with it. A bare '|' in outgoing text is a
 * malformed escape that the client drops or mangles, so the whole line silently fails
 * to display. (This is exactly how the "mode ingame|both|offline|discord" help reply
 * vanished while the pipe-free greeting arrived fine.) Doubling it is how vanilla emits
 * a literal pipe. We send only plain text, never real escapes, so escaping every '|'
 * is always correct.
 */
export function escapeChatText(message: string): string {
  return message.replace(/\|/g, "||");
}

/** Build a CMSG_MESSAGECHAT whisper to `target`. */
export function buildWhisper(target: string, message: string, language: number = LANG_UNIVERSAL): Buffer {
  return new PacketWriter()
    .u32LE(ChatType.Whisper)
    .u32LE(language)
    .cString(target)
    .cString(escapeChatText(message))
    .toBuffer();
}

/** Build a CMSG_MESSAGECHAT /yell — heard by everyone nearby in the zone, no target. */
export function buildYell(message: string, language: number = LANG_UNIVERSAL): Buffer {
  return new PacketWriter()
    .u32LE(ChatType.Yell)
    .u32LE(language)
    .cString(escapeChatText(message))
    .toBuffer();
}

/** Build a CMSG_MESSAGECHAT to guild chat (/g) — no target, like a yell. */
export function buildGuildChat(message: string, language: number = LANG_UNIVERSAL): Buffer {
  return new PacketWriter()
    .u32LE(ChatType.Guild)
    .u32LE(language)
    .cString(escapeChatText(message))
    .toBuffer();
}

/** SMSG_CHAT_PLAYER_NOT_FOUND body is the offline target's name as a CString. */
export function parsePlayerNotFound(body: Buffer): string {
  return new PacketReader(body).cString();
}

export interface GuildEventMessage {
  /** The event type (see GuildEvent) — Joined is the one we act on. */
  readonly type: number;
  /** String params: for a JOIN/LEAVE/SIGN-ON, params[0] is the character name. */
  readonly params: string[];
}

/**
 * Parse SMSG_GUILD_EVENT: u8 type, u8 count, then `count` CStrings. Some events (sign on/off)
 * append a u64 guid after the strings, which we don't read — we only need the type and names.
 * The documented 1.12 layout; confirm against a real join (every event is logged) before trusting.
 */
export function parseGuildEvent(body: Buffer): GuildEventMessage {
  const reader = new PacketReader(body);
  const type = reader.u8();
  const count = reader.u8();
  const params: string[] = [];
  for (let i = 0; i < count; i += 1) params.push(reader.cString());
  return { type, params };
}
