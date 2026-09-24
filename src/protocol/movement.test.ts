import { describe, expect, it } from "vitest";
import { PacketWriter } from "../net/byte-buffer.js";
import { parseMonsterMove, parsePlayerMovement, PLAYER_MOVEMENT_OPCODES } from "./movement.js";

const WARLOCK = 0x1234n;
const INFERNAL = 0xf130_0000_5900_0abcn;

describe("parsePlayerMovement", () => {
  it("reads who moved and where they are, past the flags and time", () => {
    const body = new PacketWriter()
      .packedGuid(WARLOCK)
      .u32LE(0x1) // moving forward
      .u32LE(123456) // time
      .f32LE(1629.5)
      .f32LE(-4373.25)
      .f32LE(31.5)
      .f32LE(3.1) // orientation
      .u32LE(0) // fall time
      .toBuffer();
    const move = parsePlayerMovement(body);
    expect(move?.guid).toBe(WARLOCK);
    expect(move?.pos.x).toBeCloseTo(1629.5, 1);
    expect(move?.pos.y).toBeCloseTo(-4373.25, 1);
    expect(move?.pos.z).toBeCloseTo(31.5, 1);
  });

  it("drops a position that is no place in the world", () => {
    const body = new PacketWriter().packedGuid(WARLOCK).u32LE(0).u32LE(0).f32LE(1e9).f32LE(0).f32LE(0).toBuffer();
    expect(parsePlayerMovement(body)).toBeNull();
    const nan = new PacketWriter().packedGuid(WARLOCK).u32LE(0).u32LE(0).f32LE(Number.NaN).f32LE(0).f32LE(0).toBuffer();
    expect(parsePlayerMovement(nan)).toBeNull();
  });
});

describe("parseMonsterMove", () => {
  it("reads which creature set off and where it is now", () => {
    const body = new PacketWriter()
      .packedGuid(INFERNAL)
      .f32LE(1630)
      .f32LE(-4370)
      .f32LE(32)
      .u32LE(77) // spline id — the path that follows is not read
      .u8(0)
      .toBuffer();
    const move = parseMonsterMove(body);
    expect(move?.guid).toBe(INFERNAL);
    expect(move?.pos.x).toBeCloseTo(1630, 1);
  });
});

describe("PLAYER_MOVEMENT_OPCODES", () => {
  it("covers the heartbeat and the start/stop of running", () => {
    for (const opcode of [0xee, 0xb5, 0xb7]) expect(PLAYER_MOVEMENT_OPCODES.has(opcode)).toBe(true);
  });
});
