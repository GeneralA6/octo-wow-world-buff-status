import { describe, expect, it } from "vitest";
import { NearbyHealers } from "./nearby-healers.js";

const at = (x: number) => ({ x, y: 0, z: 0 });
const ORC = 2;
const HUMAN = 1;
const CUSTOM_RACE = 10;
const PRIEST = 5;
const SHAMAN = 7;
const WARRIOR = 1;

function place(healers: NearbyHealers, guid: bigint, raceId: number, classId: number, x: number, health = 1000): void {
  healers.seen({ guid, raceId, classId, health });
  healers.moved({ guid, pos: at(x), destination: null });
}

describe("NearbyHealers", () => {
  it("finds the nearest player of our side who can resurrect", () => {
    const healers = new NearbyHealers();
    place(healers, 1n, ORC, PRIEST, 20);
    place(healers, 2n, ORC, SHAMAN, 8);
    place(healers, 3n, ORC, WARRIOR, 2); // cannot resurrect
    expect(healers.nearest(at(0), 30, "horde", new Set())).toEqual({ guid: 2n, classId: SHAMAN, distance: 8 });
  });

  it("passes over one out of reach, of the other side, dead, or already asked", () => {
    const healers = new NearbyHealers();
    place(healers, 1n, ORC, PRIEST, 45); // too far
    place(healers, 2n, HUMAN, PRIEST, 5); // alliance
    place(healers, 3n, ORC, PRIEST, 5, 0); // dead
    place(healers, 4n, ORC, PRIEST, 6); // asked already
    expect(healers.nearest(at(0), 30, "horde", new Set([4n]))).toBeNull();
  });

  it("counts a race not yet mapped to a side — asking an enemy is merely wasted", () => {
    const healers = new NearbyHealers();
    place(healers, 1n, CUSTOM_RACE, PRIEST, 5);
    expect(healers.nearest(at(0), 30, "horde", new Set())?.guid).toBe(1n);
  });

  it("follows a healer as they move, and forgets one who left", () => {
    const healers = new NearbyHealers();
    place(healers, 1n, ORC, PRIEST, 50);
    expect(healers.nearest(at(0), 30, "horde", new Set())).toBeNull();
    healers.moved({ guid: 1n, pos: at(10), destination: null });
    expect(healers.nearest(at(0), 30, "horde", new Set())?.distance).toBe(10);
    healers.gone(1n);
    expect(healers.nearest(at(0), 30, "horde", new Set())).toBeNull();
  });

  it("needs to know where a healer stands", () => {
    const healers = new NearbyHealers();
    healers.seen({ guid: 1n, raceId: ORC, classId: PRIEST, health: 1000 });
    expect(healers.nearest(at(0), 30, "horde", new Set())).toBeNull();
  });
});
