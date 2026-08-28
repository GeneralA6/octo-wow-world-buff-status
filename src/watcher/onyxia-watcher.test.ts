import { describe, expect, it } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { dominantGuild, OnyxiaWatcher } from "./onyxia-watcher.js";

function player(name: string, guild = "Fortitude"): WhoPlayer {
  return { name, guild, level: 60, classId: 1, raceId: 2, areaId: 2159 };
}

describe("OnyxiaWatcher", () => {
  it("says nothing on a first poll of an empty lair", () => {
    expect(new OnyxiaWatcher().update([])).toEqual([]);
  });

  it("reports an in-progress raid on the first poll as initial", () => {
    const events = new OnyxiaWatcher().update([player("Onytank"), player("Healbot")]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "raid-entered", initial: true });
  });

  it("fires raid-entered when the lair goes from empty to occupied", () => {
    const watcher = new OnyxiaWatcher();
    watcher.update([]);
    const events = watcher.update([player("Onytank")]);
    expect(events).toEqual([
      { kind: "raid-entered", players: [player("Onytank")], initial: false },
    ]);
  });

  it("fires raid-left when the lair empties", () => {
    const watcher = new OnyxiaWatcher();
    watcher.update([player("Onytank"), player("Healbot")]);
    const events = watcher.update([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "raid-left" });
    if (events[0]?.kind === "raid-left") {
      expect(events[0].previousPlayers.map((p) => p.name)).toEqual(["Onytank", "Healbot"]);
    }
  });

  it("reports roster changes while the lair stays occupied", () => {
    const watcher = new OnyxiaWatcher();
    watcher.update([player("Onytank"), player("Healbot")]);
    const events = watcher.update([player("Onytank"), player("Mage1")]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "roster-changed" });
    if (events[0]?.kind === "roster-changed") {
      expect(events[0].entered.map((p) => p.name)).toEqual(["Mage1"]);
      expect(events[0].left).toEqual(["Healbot"]);
    }
  });

  it("stays silent when the roster is unchanged", () => {
    const watcher = new OnyxiaWatcher();
    watcher.update([player("Onytank")]);
    expect(watcher.update([player("Onytank")])).toEqual([]);
  });

  it("stays silent across consecutive empty polls", () => {
    const watcher = new OnyxiaWatcher();
    watcher.update([]);
    expect(watcher.update([])).toEqual([]);
  });

  it("exposes the current roster names", () => {
    const watcher = new OnyxiaWatcher();
    watcher.update([player("Onytank"), player("Healbot")]);
    expect(watcher.currentNames).toEqual(["Onytank", "Healbot"]);
  });

  it("handles a full enter-then-leave cycle", () => {
    const watcher = new OnyxiaWatcher();
    expect(watcher.update([])).toEqual([]);
    expect(watcher.update([player("A")])[0]?.kind).toBe("raid-entered");
    expect(watcher.update([player("A"), player("B")])[0]?.kind).toBe("roster-changed");
    expect(watcher.update([])[0]?.kind).toBe("raid-left");
    expect(watcher.update([])).toEqual([]);
  });
});

describe("dominantGuild", () => {
  it("returns the most common non-empty guild", () => {
    const players = [
      player("A", "Fortitude"),
      player("B", "Fortitude"),
      player("C", "Onslaught"),
    ];
    expect(dominantGuild(players)).toEqual({ guild: "Fortitude", count: 2 });
  });

  it("ignores guildless players and returns null when there are no guilds", () => {
    expect(dominantGuild([player("A", ""), player("B", "")])).toBeNull();
  });
});
