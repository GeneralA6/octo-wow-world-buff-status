import type { CombatEvent } from "../protocol/combat-log.js";
import { unitRef } from "../protocol/guid.js";
import { ChatType } from "../protocol/opcodes.js";
import type { DeathClue, DeathReport } from "./death-recorder.js";

/**
 * Turns a death report into log lines a person can read: who hit us, with what, what was said
 * nearby, and a one-line verdict naming the killing blow.
 *
 * Names are looked up at format time, so whatever resolved while the fight was on is used; a unit
 * still unnamed is shown by its guid, which is enough to look it up later.
 */

export interface UnitNames {
  /** A player's name, when a name query has resolved it. */
  player(guid: bigint): string | undefined;
  /** A creature entry's name, when a creature query has resolved it. */
  creature(entry: number): string | undefined;
}

export function describeUnit(guid: bigint, selfGuid: bigint, names: UnitNames): string {
  if (guid === selfGuid) return "us";
  const ref = unitRef(guid);
  const hex = `0x${guid.toString(16)}`;
  switch (ref.kind) {
    case "player":
      return `${names.player(guid) ?? hex} (player)`;
    case "creature":
      return `${names.creature(ref.entry) ?? `creature #${ref.entry}`} (npc)`;
    case "pet":
      return `${names.creature(ref.entry) ?? `pet #${ref.entry}`} (pet)`;
    case "other":
      return hex;
  }
}

function describeCombat(event: CombatEvent, selfGuid: bigint, names: UnitNames): string {
  const target = describeUnit(event.target, selfGuid, names);
  switch (event.kind) {
    case "attack-start":
      return `${describeUnit(event.attacker, selfGuid, names)} starts attacking ${target}`;
    case "melee":
      return `${describeUnit(event.attacker, selfGuid, names)} hits ${target} for ${event.damage} (melee)`;
    case "spell":
      return `${describeUnit(event.attacker, selfGuid, names)} hits ${target} for ${event.damage} with spell ${event.spellId}`;
    case "periodic":
      return `${describeUnit(event.attacker, selfGuid, names)} ticks ${target} for ${event.damage} with spell ${event.spellId}`;
    case "environmental":
      return `${target} takes ${event.damage} ${event.cause} damage`;
  }
}

const CHAT_VERBS: ReadonlyMap<number, string> = new Map([
  [ChatType.Say, "says"],
  [ChatType.Yell, "yells"],
  [ChatType.Emote, "emotes"],
]);

function describeClue(clue: DeathClue, selfGuid: bigint, names: UnitNames): string {
  switch (clue.kind) {
    case "combat":
      return describeCombat(clue.event, selfGuid, names);
    case "chat":
      return `${describeUnit(clue.senderGuid, selfGuid, names)} ${CHAT_VERBS.get(clue.chatType) ?? "says"}: ${JSON.stringify(clue.text)}`;
    case "health":
      return clue.health === 0 ? "health 0 — dead" : `health ${clue.health}`;
  }
}

/** Where the last damage before the death came from, or null when none was seen. */
export function killingBlow(report: DeathReport, selfGuid: bigint, names: UnitNames): string | null {
  for (let i = report.clues.length - 1; i >= 0; i -= 1) {
    const clue = report.clues[i];
    if (clue?.kind !== "combat" || clue.event.kind === "attack-start") continue;
    if (clue.event.target !== selfGuid) continue;
    return describeCombat(clue.event, selfGuid, names);
  }
  return null;
}

/** The report as log lines: a verdict, then every clue timed relative to the death. */
export function formatDeathReport(report: DeathReport, selfGuid: bigint, names: UnitNames, windowMs: number): string[] {
  const blow = killingBlow(report, selfGuid, names);
  const verdict = blow
    ? `killing blow: ${blow}`
    : "no damage was seen before it — not killed by a hit we could see (an instant kill, or the combat log was not sent)";
  const lines = [`DIED — ${verdict}. Last ${Math.round(windowMs / 1000)}s:`];
  for (const clue of report.clues) {
    const offset = ((clue.at - report.diedAt) / 1000).toFixed(1).padStart(6);
    lines.push(`  ${offset}s  ${describeClue(clue, selfGuid, names)}`);
  }
  return lines;
}
