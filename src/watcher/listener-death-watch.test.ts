import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatType } from "../protocol/opcodes.js";
import { ListenerDeathWatch, type ListenerDeathWatchDeps } from "./listener-death-watch.js";

const US = 0x77n;
const GANKER = 0x555n;
const GRUNT = 0xf130_000c_9300_0042n;

function setup(selfGuid: bigint | null = US) {
  const names = new Map<bigint, string>();
  const deps = {
    selfGuid: () => selfGuid,
    playerName: (guid: bigint) => names.get(guid),
    queryName: vi.fn<(guid: bigint) => void>(),
    queryCreature: vi.fn<(entry: number, guid: bigint) => void>(),
    report: vi.fn<(lines: string[]) => void>(),
  } satisfies ListenerDeathWatchDeps;
  const watch = new ListenerDeathWatch(deps, { windowMs: 30_000, reportDelayMs: 2_000 });
  return { watch, deps, names };
}

describe("ListenerDeathWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports who killed us, once names have had a moment to resolve", () => {
    const { watch, deps, names } = setup();
    watch.health(3000);
    vi.advanceTimersByTime(1_000);
    watch.combat({ kind: "spell", attacker: GANKER, target: US, spellId: 12294, damage: 3000 });
    watch.health(0);

    names.set(GANKER, "Ganker"); // the name query answers during the grace period
    expect(deps.report).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);

    expect(deps.report).toHaveBeenCalledTimes(1);
    const lines = deps.report.mock.calls[0]?.[0] ?? [];
    expect(lines[0]).toBe("DIED — killing blow: Ganker (player) hits us for 3000 with spell 12294. Last 30s:");
    expect(lines).toContain("     0.0s  health 0 — dead");
  });

  it("names a player attacker by name query and an NPC by creature query", () => {
    const { watch, deps } = setup();
    watch.combat({ kind: "melee", attacker: GANKER, target: US, damage: 10 });
    watch.combat({ kind: "melee", attacker: GRUNT, target: US, damage: 10 });
    expect(deps.queryName).toHaveBeenCalledWith(GANKER);
    expect(deps.queryCreature).toHaveBeenCalledWith(0x0c93, GRUNT);
  });

  it("uses creature names as they are answered", () => {
    const { watch, deps } = setup();
    watch.health(3000);
    watch.combat({ kind: "melee", attacker: GRUNT, target: US, damage: 3000 });
    watch.creatureName(0x0c93, "Orgrimmar Grunt");
    watch.health(0);
    vi.advanceTimersByTime(2_000);
    expect(deps.report.mock.calls[0]?.[0][0]).toContain("Orgrimmar Grunt (npc) hits us for 3000 (melee)");
  });

  it("ignores hits on anyone else", () => {
    const { watch, deps } = setup();
    watch.health(3000);
    watch.combat({ kind: "melee", attacker: GRUNT, target: GANKER, damage: 500 });
    watch.health(0);
    vi.advanceTimersByTime(2_000);
    expect(deps.queryCreature).not.toHaveBeenCalled();
    expect(deps.report.mock.calls[0]?.[0][0]).toMatch(/^DIED — no damage was seen/);
  });

  it("keeps nearby chat and asks who said it", () => {
    const { watch, deps, names } = setup();
    names.set(GANKER, "Ganker");
    watch.health(3000);
    watch.chat({ type: ChatType.Yell, language: 1, senderGuid: GANKER, text: "die bot" });
    watch.health(0);
    vi.advanceTimersByTime(2_000);
    expect(deps.queryName).toHaveBeenCalledWith(GANKER);
    expect(deps.report.mock.calls[0]?.[0]).toContain('     0.0s  Ganker (player) yells: "die bot"');
  });

  it("records nothing before it knows who we are", () => {
    const { watch, deps } = setup(null);
    watch.health(3000);
    watch.combat({ kind: "melee", attacker: GANKER, target: US, damage: 3000 });
    watch.health(0);
    vi.advanceTimersByTime(2_000);
    expect(deps.queryName).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("drops a pending report when the session ends", () => {
    const { watch, deps } = setup();
    watch.health(3000);
    watch.health(0);
    watch.dispose();
    vi.advanceTimersByTime(2_000);
    expect(deps.report).not.toHaveBeenCalled();
  });
});
