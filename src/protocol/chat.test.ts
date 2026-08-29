import { describe, expect, it } from "vitest";
import { PacketReader, PacketWriter } from "../net/byte-buffer.js";
import { ChatType, LANG_UNIVERSAL } from "./opcodes.js";
import { buildWhisper, parseServerChat } from "./chat.js";

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
