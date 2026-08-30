import { PacketReader } from "../net/byte-buffer.js";

/**
 * Parse an SMSG_UPDATE_OBJECT block (already decompressed) far enough to pull out
 * nearby GameObjects (guid + entry + position) and our own player position — enough
 * to interact with the closest object (e.g. sit on the bench a character is parked on).
 *
 * Confirmed against live OctoWoW captures — stock 1.12 layout:
 *   u32 count, u8 hasTransport, then `count` blocks:
 *     u8 updateType; packedGuid; then per type:
 *       CREATE(2)/CREATE2(3): u8 objectType, u8 updateFlags, movementBlock, valuesBlock
 *       VALUES(0): valuesBlock ;  MOVEMENT(1): movementBlock
 *       OUT_OF_RANGE(4)/NEAR(5): u32 n, n packedGuids
 *
 * We decode only what we need. A MOVING unit (LIVING with non-zero movement flags) has
 * a variable-length block we don't decode, so hitting one throws — and the caller keeps
 * whatever it read from the earlier, cleanly-parsed packets.
 */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface WorldGameObject {
  readonly guid: bigint;
  readonly entry: number;
  readonly pos: WorldPoint;
}

export interface WorldObjects {
  readonly gameObjects: WorldGameObject[];
  /** Our own player's position, when this block created it. */
  readonly self: WorldPoint | null;
}

const OBJTYPE_PLAYER = 4;
const OBJTYPE_GAMEOBJECT = 5;

const UPDATEFLAG_TRANSPORT = 0x02;
const UPDATEFLAG_HIGHGUID = 0x08;
const UPDATEFLAG_ALL = 0x10;
const UPDATEFLAG_LIVING = 0x20;
const UPDATEFLAG_HAS_POSITION = 0x40;

const UPDATETYPE_VALUES = 0;
const UPDATETYPE_MOVEMENT = 1;
const UPDATETYPE_CREATE = 2;
const UPDATETYPE_CREATE2 = 3;
const UPDATETYPE_OUT_OF_RANGE = 4;
const UPDATETYPE_NEAR = 5;

export function parseUpdateObject(body: Buffer): WorldObjects {
  const reader = new PacketReader(body);
  const count = reader.u32LE();
  reader.u8(); // hasTransport
  const gameObjects: WorldGameObject[] = [];
  let self: WorldPoint | null = null;

  for (let i = 0; i < count; i += 1) {
    const updateType = reader.u8();
    if (updateType === UPDATETYPE_OUT_OF_RANGE || updateType === UPDATETYPE_NEAR) {
      const n = reader.u32LE();
      for (let j = 0; j < n; j += 1) readPackedGuid(reader);
      continue;
    }
    const guid = readPackedGuid(reader);
    if (updateType === UPDATETYPE_CREATE || updateType === UPDATETYPE_CREATE2) {
      const objType = reader.u8();
      const flags = reader.u8();
      const pos = readMovement(reader, flags);
      const entry = readValuesEntry(reader);
      if (objType === OBJTYPE_GAMEOBJECT && pos) gameObjects.push({ guid, entry, pos });
      if (objType === OBJTYPE_PLAYER && pos) self = pos;
    } else if (updateType === UPDATETYPE_VALUES) {
      readValuesEntry(reader);
    } else if (updateType === UPDATETYPE_MOVEMENT) {
      readMovement(reader, reader.u8());
    } else {
      throw new Error(`unknown updateType ${updateType}`);
    }
  }
  return { gameObjects, self };
}

function readPackedGuid(reader: PacketReader): bigint {
  const mask = reader.u8();
  let guid = 0n;
  for (let i = 0; i < 8; i += 1) {
    if (mask & (1 << i)) guid |= BigInt(reader.u8()) << BigInt(i * 8);
  }
  return guid;
}

function readMovement(reader: PacketReader, flags: number): WorldPoint | null {
  let pos: WorldPoint | null = null;
  if (flags & UPDATEFLAG_LIVING) {
    const moveFlags = reader.u32LE();
    if (moveFlags !== 0) throw new Error("moving unit (non-zero movement flags)");
    reader.u32LE(); // time
    pos = { x: reader.f32LE(), y: reader.f32LE(), z: reader.f32LE() };
    reader.f32LE(); // orientation
    reader.u32LE(); // fall time
    for (let i = 0; i < 6; i += 1) reader.f32LE(); // speeds
  } else if (flags & UPDATEFLAG_HAS_POSITION) {
    pos = { x: reader.f32LE(), y: reader.f32LE(), z: reader.f32LE() };
    reader.f32LE(); // orientation
  }
  if (flags & UPDATEFLAG_ALL) reader.u32LE();
  if (flags & UPDATEFLAG_HIGHGUID) reader.u32LE();
  if (flags & UPDATEFLAG_TRANSPORT) reader.u32LE();
  return pos;
}

/** Read a values block, returning OBJECT_FIELD_ENTRY (field 3) if present, else 0. */
function readValuesEntry(reader: PacketReader): number {
  const blockCount = reader.u8();
  const mask: number[] = [];
  for (let i = 0; i < blockCount; i += 1) mask.push(reader.u32LE());
  let entry = 0;
  for (let idx = 0; idx < blockCount * 32; idx += 1) {
    if (((mask[idx >>> 5] ?? 0) >>> (idx & 31)) & 1) {
      const value = reader.u32LE();
      if (idx === 3) entry = value; // OBJECT_FIELD_ENTRY
    }
  }
  return entry;
}

/** The GameObject nearest a point (by squared distance), or null if there are none. */
export function nearestGameObject(
  objects: readonly WorldGameObject[],
  to: WorldPoint,
): WorldGameObject | null {
  let best: WorldGameObject | null = null;
  let bestDistSq = Infinity;
  for (const go of objects) {
    const dx = go.pos.x - to.x;
    const dy = go.pos.y - to.y;
    const dz = go.pos.z - to.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = go;
    }
  }
  return best;
}
