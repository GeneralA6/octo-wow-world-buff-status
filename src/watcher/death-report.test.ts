import { describe, expect, it } from "vitest";
import { ChatType } from "../protocol/opcodes.js";
import type { DeathReport } from "./death-recorder.js";
import { describeUnit, formatDeathReport, killingBlow, type UnitNames } from "./death-report.js";

const US = 0x77n;
const GANKER = 0x555n;
const STRANGER = 0x999n;
const GRUNT = 0xf130_000c_9300_0042n;

const names: UnitNames = {
  player: (guid) => (guid === GANKER ? "Ganker" : undefined),
  creature: (entry) => (entry === 0x0c93 ? "Orgrimmar Grunt" : undefined),
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
    { at: 2_000, kind: "combat", event: { kind: "attack-start", attacker: GANKER, target: US } },
    { at: 2_500, kind: "combat", event: { kind: "melee", attacker: GANKER, target: US, damage: 400 } },
    { at: 10_000, kind: "health", health: 1200 },
    {
      at: 29_900,
      kind: "combat",
      event: { kind: "spell", attacker: GANKER, target: US, spellId: 12294, damage: 1240 },
    },
    { at: 29_950, kind: "combat", event: { kind: "melee", attacker: GRUNT, target: GANKER, damage: 90 } },
    { at: 30_000, kind: "health", health: 0 },
  ],
};

describe("killingBlow", () => {
  it("is the last damage WE took, not a later hit on someone else", () => {
    expect(killingBlow(report, US, names)).toBe("Ganker (player) hits us for 1240 with spell 12294");
  });

  it("is null when no damage reached us", () => {
    const quiet: DeathReport = { diedAt: 1, clues: [{ at: 1, kind: "health", health: 0 }] };
    expect(killingBlow(quiet, US, names)).toBeNull();
  });
});

describe("formatDeathReport", () => {
  it("leads with the verdict and times every clue relative to the death", () => {
    expect(formatDeathReport(report, US, names, 30_000)).toEqual([
      "DIED — killing blow: Ganker (player) hits us for 1240 with spell 12294. Last 30s:",
      '   -29.0s  Ganker (player) says: "nice bot"',
      "   -28.0s  Ganker (player) starts attacking us",
      "   -27.5s  Ganker (player) hits us for 400 (melee)",
      "   -20.0s  health 1200",
      "    -0.1s  Ganker (player) hits us for 1240 with spell 12294",
      "    -0.1s  Orgrimmar Grunt (npc) hits Ganker (player) for 90 (melee)",
      "     0.0s  health 0 — dead",
    ]);
  });

  it("says so when the death came without any damage we saw", () => {
    const quiet: DeathReport = { diedAt: 5, clues: [{ at: 5, kind: "health", health: 0 }] };
    expect(formatDeathReport(quiet, US, names, 30_000)[0]).toMatch(/^DIED — no damage was seen/);
  });
});
