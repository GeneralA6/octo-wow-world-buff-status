import { describe, expect, it } from "vitest";
import { PacketReader, PacketWriter } from "../net/byte-buffer.js";
import { ChatType, LANG_UNIVERSAL } from "./opcodes.js";
import {
  buildWhisper,
  isMonsterChatType,
  parseMonsterChat,
  parsePlayerNotFound,
  parseServerChat,
} from "./chat.js";

/** Assemble an SMSG_MESSAGECHAT player-message body the way the server would. */
function serverChat(type: number, guid: bigint, text: string, language = 7): Buffer {
  const msg = Buffer.from(text, "utf8");
  return new PacketWriter()
    .u8(type)
    .u32LE(language)
    .u64LE(guid)
    .u32LE(msg.length + 1) // length includes the null terminator
    .bytes(msg)
    .u8(0)
    .u8(0) // chat tag
    .toBuffer();
}

/** Assemble an SMSG_MESSAGECHAT monster-message body (name inline). */
function monsterChat(
  type: number,
  guid: bigint,
  senderName: string,
  text: string,
  targetGuid = 0n,
  language = 0,
): Buffer {
  const name = Buffer.from(senderName, "utf8");
  const msg = Buffer.from(text, "utf8");
  return new PacketWriter()
    .u8(type)
    .u32LE(language)
    .u64LE(guid)
    .u32LE(name.length + 1)
    .bytes(name)
    .u8(0)
    .u64LE(targetGuid)
    .u32LE(msg.length + 1)
    .bytes(msg)
    .u8(0)
    .u8(0) // chat tag
    .toBuffer();
}

describe("parseServerChat", () => {
  it("reads type, language, sender guid and text from a whisper", () => {
    const body = serverChat(ChatType.Whisper, 0x1122334455n, "subscribe");
    const chat = parseServerChat(body);
    expect(chat.type).toBe(ChatType.Whisper);
    expect(chat.language).toBe(7);
    expect(chat.senderGuid).toBe(0x1122334455n);
    expect(chat.text).toBe("subscribe");
  });

  it("stops the text at the null terminator", () => {
    const body = serverChat(ChatType.Whisper, 42n, "status");
    expect(parseServerChat(body).text).toBe("status");
  });

  it("handles UTF-8 text", () => {
    const body = serverChat(ChatType.Whisper, 1n, "héllo");
    expect(parseServerChat(body).text).toBe("héllo");
  });
});

describe("parseMonsterChat", () => {
  it("reads the sender name and text past the inline name field", () => {
    const body = monsterChat(
      ChatType.MonsterYell,
      0x9988n,
      "Major Mattingly",
      "The dread lady, Onyxia, hangs from the arches!",
    );
    const chat = parseMonsterChat(body);
    expect(chat.type).toBe(ChatType.MonsterYell);
    expect(chat.senderName).toBe("Major Mattingly");
    expect(chat.text).toBe("The dread lady, Onyxia, hangs from the arches!");
  });

  it("would misread if parsed as a player message (why the layout matters)", () => {
    const body = monsterChat(ChatType.MonsterYell, 1n, "Runthak", "For the Horde!");
    // The player parser reads the name-length u32 as the message length → not the text.
    expect(parseServerChat(body).text).not.toBe("For the Horde!");
  });
});

describe("isMonsterChatType", () => {
  it("recognises the monster chat types and rejects player ones", () => {
    expect(isMonsterChatType(ChatType.MonsterYell)).toBe(true);
    expect(isMonsterChatType(ChatType.MonsterSay)).toBe(true);
    expect(isMonsterChatType(ChatType.Whisper)).toBe(false);
    expect(isMonsterChatType(ChatType.Yell)).toBe(false);
  });
});

describe("buildWhisper", () => {
  it("encodes a universal-language whisper to a named target", () => {
    const frame = buildWhisper("Raider", "A raid is forming!");
    const reader = new PacketReader(frame);
    expect(reader.u32LE()).toBe(ChatType.Whisper);
    expect(reader.u32LE()).toBe(LANG_UNIVERSAL);
    expect(reader.cString()).toBe("Raider");
    expect(reader.cString()).toBe("A raid is forming!");
    expect(reader.remaining).toBe(0);
  });

  it("accepts an explicit language", () => {
    const frame = buildWhisper("Raider", "hi", 7);
    const reader = new PacketReader(frame);
    reader.u32LE();
    expect(reader.u32LE()).toBe(7);
  });
});

describe("parsePlayerNotFound", () => {
  it("reads the offline target's name", () => {
    const body = new PacketWriter().cString("OfflineGuy").toBuffer();
    expect(parsePlayerNotFound(body)).toBe("OfflineGuy");
  });
});
