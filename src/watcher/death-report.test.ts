import { describe, expect, it } from "vitest";
import { ChatType } from "../protocol/opcodes.js";
import type { UnitOwner } from "../protocol/unit-owner.js";
import type { DeathReport } from "./death-recorder.js";
import { describeDeath, describeUnit, formatDeathReport, killingBlow, type UnitNames } from "./death-report.js";

const US = 0x77n;
const GANKER = 0x555n;
const STRANGER = 0x999n;
const GRUNT = 0xf130_000c_9300_0042n;
const INFERNAL = 0xf130_0000_5900_0abcn; // creature entry 89

const names: UnitNames = {
  player: (guid) => (guid === GANKER ? "Ganker" : undefined),
  creature: (entry) => new Map([[0x0c93, "Orgrimmar Grunt"], [89, "Infernal"]]).get(entry),
};

describe("describeUnit", () => {
  it("names us, players, creatures and pets, falling back to ids", () => {
    expect(describeUnit(US, US, names)).toBe("us");
    expect(describeUnit(GANKER, US, names)).toBe("Ganker (player)");
    expect(describeUnit(STRANGER, US, names)).toBe("0x999 (player)");
    expect(describeUnit(GRUNT, US, names)).toBe("Orgrimmar Grunt (npc)");
    expect(describeUnit(0xf130_0000_0100_0001n, US, names)).toBe("creature #1 (npc)");
    expect(describeUnit(0xf140_0000_0200_0001n, US, names)).toBe("pet #2 (pet)");
  });
});

const report: DeathReport = {
  diedAt: 30_000,
  clues: [
    { at: 1_000, kind: "chat", senderGuid: GANKER, chatType: ChatType.Say, text: "nice bot" },
    { at: 2_000, kind: "combat", event: { kind: "attack-start", attacker: GANKER, target: US }, attackerOwner: null },
    {
      at: 2_500,
      kind: "combat",
      event: { kind: "melee", attacker: GANKER, target: US, damage: 400 },
      attackerOwner: null,
    },
    { at: 10_000, kind: "health", health: 1200 },
    { at: 15_000, kind: "system", text: "You are now PvP flagged." },
    {
      at: 29_900,
      kind: "combat",
      event: { kind: "spell", attacker: GANKER, target: US, spellId: 12294, damage: 1240 },
      attackerOwner: null,
    },
    {
      at: 29_950,
      kind: "combat",
      event: { kind: "melee", attacker: GRUNT, target: GANKER, damage: 90 },
      attackerOwner: null,
    },
    { at: 30_000, kind: "health", health: 0 },
  ],
};

describe("killingBlow", () => {
  it("is the last damage WE took, not a later hit on someone else", () => {
    expect(killingBlow(report, US, names)).toBe("Ganker (player) hits us for 1240 with spell 12294");
  });

  /** A report whose last clue is an Infernal's Immolation tick, owned as given. */
  function burned(attackerOwner: UnitOwner | null): DeathReport {
    return {
      diedAt: 2_000,
      clues: [
        {
          at: 2_000,
          kind: "combat",
          event: { kind: "spell", attacker: INFERNAL, target: US, spellId: 20153, damage: 28 },
          attackerOwner,
        },
      ],
    };
  }

  it("names who a unit answered to when it struck", () => {
    const owner: UnitOwner = { relation: "controlled", guid: GANKER, current: true };
    expect(killingBlow(burned(owner), US, names)).toBe(
      "Infernal (npc) controlled by Ganker (player) hits us for 28 with spell 20153",
    );
  });

  it("says an owner is a former one once the unit broke free", () => {
    const owner: UnitOwner = { relation: "controlled", guid: GANKER, current: false };
    expect(killingBlow(burned(owner), US, names)).toBe(
      "Infernal (npc) formerly controlled by Ganker (player) hits us for 28 with spell 20153",
    );
  });

  it("shows an owner whose name never came back by guid", () => {
    const owner: UnitOwner = { relation: "created", guid: STRANGER, current: true };
    expect(killingBlow(burned(owner), US, names)).toBe(
      "Infernal (npc) created by 0x999 (player) hits us for 28 with spell 20153",
    );
  });

  it("is null when no damage reached us", () => {
    const quiet: DeathReport = { diedAt: 1, clues: [{ at: 1, kind: "health", health: 0 }] };
    expect(killingBlow(quiet, US, names)).toBeNull();
  });
});

describe("describeDeath", () => {
  it("names the killing blow and times every clue relative to the death", () => {
    expect(describeDeath(report, US, names)).toEqual({
      verdict: "killing blow: Ganker (player) hits us for 1240 with spell 12294",
      timeline: [
        ' -29.0s  Ganker (player) says: "nice bot"',
        " -28.0s  Ganker (player) starts attacking us",
        " -27.5s  Ganker (player) hits us for 400 (melee)",
        " -20.0s  health 1200",
        ' -15.0s  system: "You are now PvP flagged."',
        "  -0.1s  Ganker (player) hits us for 1240 with spell 12294",
        "  -0.1s  Orgrimmar Grunt (npc) hits Ganker (player) for 90 (melee)",
        "   0.0s  health 0 — dead",
      ],
    });
  });

  it("says so when the death came without any damage we saw", () => {
    const quiet: DeathReport = { diedAt: 5, clues: [{ at: 5, kind: "health", health: 0 }] };
    expect(describeDeath(quiet, US, names).verdict).toMatch(/^no damage was seen/);
  });
});

describe("formatDeathReport", () => {
  it("leads the log with the verdict and indents the timeline under it", () => {
    const account = { verdict: "killing blow: Ganker (player) hits us for 3000 (melee)", timeline: ["   0.0s  health 0 — dead"] };
    expect(formatDeathReport(account, 30_000)).toEqual([
      "DIED — killing blow: Ganker (player) hits us for 3000 (melee). Last 30s:",
      "     0.0s  health 0 — dead",
    ]);
  });
});
