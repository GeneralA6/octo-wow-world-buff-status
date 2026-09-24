import { PacketReader } from "../net/byte-buffer.js";
import type { WorldPoint } from "./update-object.js";

/**
 * Where a unit near us is as it moves, from the packets the server relays while it does.
 *
 *   MSG_MOVE_* (a player's own movement, relayed): packedGuid, then MovementInfo — u32 flags,
 *     u32 time, f32 x, y, z, orientation, and more — of which only the position is read.
 *   SMSG_MONSTER_MOVE (a creature setting off on a path): packedGuid, f32 x, y, z — where it is
 *     now — then the path, which is not read.
 *
 * These are the stock 1.12 opcodes and layouts, which the rest of this protocol matches on OctoWoW,
 * but no capture of these packets has confirmed them here. So a position that is no plausible place
 * in the world is dropped rather than trusted; a unit that comes into view still arrives with its
 * position in its object create block, which is confirmed.
 */

/** The opcodes that relay a player's movement (stock 1.12). */
export const PLAYER_MOVEMENT_OPCODES: ReadonlySet<number> = new Set([
  0xb5, // MSG_MOVE_START_FORWARD
  0xb6, // MSG_MOVE_START_BACKWARD
  0xb7, // MSG_MOVE_STOP
  0xb8, // MSG_MOVE_START_STRAFE_LEFT
  0xb9, // MSG_MOVE_START_STRAFE_RIGHT
  0xba, // MSG_MOVE_STOP_STRAFE
  0xbb, // MSG_MOVE_JUMP
  0xbc, // MSG_MOVE_START_TURN_LEFT
  0xbd, // MSG_MOVE_START_TURN_RIGHT
  0xbe, // MSG_MOVE_STOP_TURN
  0xbf, // MSG_MOVE_START_PITCH_UP
  0xc0, // MSG_MOVE_START_PITCH_DOWN
  0xc1, // MSG_MOVE_STOP_PITCH
  0xc2, // MSG_MOVE_SET_RUN_MODE
  0xc3, // MSG_MOVE_SET_WALK_MODE
  0xc9, // MSG_MOVE_FALL_LAND
  0xca, // MSG_MOVE_START_SWIM
  0xcb, // MSG_MOVE_STOP_SWIM
  0xda, // MSG_MOVE_SET_FACING
  0xdb, // MSG_MOVE_SET_PITCH
  0xee, // MSG_MOVE_HEARTBEAT
]);

/** A unit, and where it is. */
export interface UnitPosition {
  readonly guid: bigint;
  readonly pos: WorldPoint;
}

/** A relayed player movement: who moved and where they are, or null for an implausible position. */
export function parsePlayerMovement(body: Buffer): UnitPosition | null {
  const reader = new PacketReader(body);
  const guid = reader.packedGuid();
  reader.u32LE(); // movement flags
  reader.u32LE(); // time
  return located(guid, reader);
}

/** A creature setting off: which one and where it is now, or null for an implausible position. */
export function parseMonsterMove(body: Buffer): UnitPosition | null {
  const reader = new PacketReader(body);
  return located(reader.packedGuid(), reader);
}

/** Past this on any axis a coordinate is no place in the 1.12 world — a misread, not a position. */
const WORLD_EXTENT = 20_000;

function located(guid: bigint, reader: PacketReader): UnitPosition | null {
  const pos = { x: reader.f32LE(), y: reader.f32LE(), z: reader.f32LE() };
  const plausible = [pos.x, pos.y, pos.z].every((value) => Number.isFinite(value) && Math.abs(value) <= WORLD_EXTENT);
  return plausible ? { guid, pos } : null;
}
