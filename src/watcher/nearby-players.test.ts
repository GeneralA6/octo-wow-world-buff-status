import { describe, expect, it } from "vitest";
import { NearbyPlayers } from "./nearby-players.js";

const at = (x: number) => ({ x, y: 0, z: 0 });
const ORC = 2;
const HUMAN = 1;
const CUSTOM_RACE = 10;
const PRIEST = 5;
const SHAMAN = 7;
const WARRIOR = 1;
const WARLOCK = 9;

function place(players: NearbyPlayers, guid: bigint, raceId: number, classId: number, x: number, health = 1000): void {
  players.seen({ guid, raceId, classId, health });
  players.moved({ guid, pos: at(x), destination: null });
}

describe("NearbyPlayers.nearestHealer", () => {
  it("finds the nearest player of our side who can resurrect", () => {
    const players = new NearbyPlayers();
    place(players, 1n, ORC, PRIEST, 20);
    place(players, 2n, ORC, SHAMAN, 8);
    place(players, 3n, ORC, WARRIOR, 2); // cannot resurrect
    expect(players.nearestHealer(at(0), 30, "horde", new Set())).toEqual({ guid: 2n, classId: SHAMAN, distance: 8 });
  });

  it("passes over one out of reach, of the other side, dead, or already asked", () => {
    const players = new NearbyPlayers();
    place(players, 1n, ORC, PRIEST, 45); // too far
    place(players, 2n, HUMAN, PRIEST, 5); // alliance
    place(players, 3n, ORC, PRIEST, 5, 0); // dead
    place(players, 4n, ORC, PRIEST, 6); // asked already
    expect(players.nearestHealer(at(0), 30, "horde", new Set([4n]))).toBeNull();
  });

  it("counts a race not yet mapped to a side — asking an enemy is merely wasted", () => {
    const players = new NearbyPlayers();
    place(players, 1n, CUSTOM_RACE, PRIEST, 5);
    expect(players.nearestHealer(at(0), 30, "horde", new Set())?.guid).toBe(1n);
  });

  it("follows a healer as they move, and forgets one who left", () => {
    const players = new NearbyPlayers();
    place(players, 1n, ORC, PRIEST, 50);
    expect(players.nearestHealer(at(0), 30, "horde", new Set())).toBeNull();
    players.moved({ guid: 1n, pos: at(10), destination: null });
    expect(players.nearestHealer(at(0), 30, "horde", new Set())?.distance).toBe(10);
    players.gone(1n);
    expect(players.nearestHealer(at(0), 30, "horde", new Set())).toBeNull();
  });

  it("needs to know where a healer stands", () => {
    const players = new NearbyPlayers();
    players.seen({ guid: 1n, raceId: ORC, classId: PRIEST, health: 1000 });
    expect(players.nearestHealer(at(0), 30, "horde", new Set())).toBeNull();
  });
});

describe("NearbyPlayers.around", () => {
  it("lists every player in reach, of any class or side, nearest first", () => {
    const players = new NearbyPlayers();
    place(players, 1n, ORC, WARLOCK, 20);
    place(players, 2n, HUMAN, WARRIOR, 4);
    place(players, 3n, ORC, PRIEST, 40); // out of reach
    expect(players.around(at(0), 25)).toEqual([
      { guid: 2n, classId: WARRIOR, distance: 4 },
      { guid: 1n, classId: WARLOCK, distance: 20 },
    ]);
  });

  it("leaves out a player whose place is not known yet, and one who left", () => {
    const players = new NearbyPlayers();
    players.seen({ guid: 1n, raceId: ORC, classId: WARLOCK, health: 1000 });
    place(players, 2n, ORC, WARLOCK, 5);
    players.gone(2n);
    expect(players.around(at(0), 25)).toEqual([]);
  });
});
