import { describe, expect, it, vi } from "vitest";
import type { UnitOwner } from "../protocol/unit-owner.js";
import { ThreatWatch, type Threat } from "./threat-watch.js";

const INFERNAL = 0xf130_0000_5900_0abcn; // creature entry 89
const GRUNT = 0xf130_000c_9300_0042n;
const GANKER = 0x555n;
const RAIDER = 0x666n;
const WARLOCK = 0x1234n;

const at = (x: number, y = 0, z = 0) => ({ x, y, z });

function setup(shunned: readonly bigint[] = [GANKER], owners = new Map<bigint, UnitOwner>()) {
  const threats: Threat[] = [];
  const watch = new ThreatWatch(
    {
      isShunned: (guid) => shunned.includes(guid),
      ownerOf: (guid) => owners.get(guid) ?? null,
      onThreat: vi.fn((threat: Threat) => threats.push(threat)),
    },
    { radiusYd: 30 },
  );
  return { watch, threats };
}

describe("ThreatWatch", () => {
  it("reports an Infernal within reach, naming who holds it", () => {
    const owner: UnitOwner = { relation: "controlled", guid: WARLOCK, current: true };
    const { watch, threats } = setup([], new Map([[INFERNAL, owner]]));
    watch.self(at(0));
    watch.moved({ guid: INFERNAL, pos: at(20) });
    expect(threats).toEqual([{ kind: "infernal", guid: INFERNAL, owner, distance: 20 }]);
  });

  it("lets an Infernal across the square be, and reports it once it walks within reach", () => {
    const { watch, threats } = setup([]);
    watch.self(at(0));
    watch.moved({ guid: INFERNAL, pos: at(60) });
    expect(threats).toEqual([]);
    watch.moved({ guid: INFERNAL, pos: at(0, 25) });
    expect(threats).toEqual([{ kind: "infernal", guid: INFERNAL, owner: null, distance: 25 }]);
  });

  it("reports a player on the wall of shame within reach, but not anyone else", () => {
    const { watch, threats } = setup([GANKER]);
    watch.self(at(0));
    watch.moved({ guid: RAIDER, pos: at(1) });
    watch.moved({ guid: GRUNT, pos: at(1) });
    expect(threats).toEqual([]);
    watch.moved({ guid: GANKER, pos: at(0, 0, 10) });
    expect(threats).toEqual([{ kind: "shunned-player", guid: GANKER, distance: 10 }]);
  });

  it("judges what it saw before it knew where we stand", () => {
    const { watch, threats } = setup([]);
    watch.moved({ guid: INFERNAL, pos: at(5) });
    expect(threats).toEqual([]);
    watch.self(at(0));
    expect(threats).toHaveLength(1);
  });

  it("reports only the first threat — the answer to it is to leave", () => {
    const { watch, threats } = setup([GANKER]);
    watch.self(at(0));
    watch.moved({ guid: INFERNAL, pos: at(5) });
    watch.moved({ guid: GANKER, pos: at(5) });
    expect(threats).toHaveLength(1);
  });

  it("forgets a unit that left view", () => {
    const { watch, threats } = setup([]);
    watch.moved({ guid: INFERNAL, pos: at(5) });
    watch.gone(INFERNAL);
    watch.self(at(0));
    expect(threats).toEqual([]);
  });
});
