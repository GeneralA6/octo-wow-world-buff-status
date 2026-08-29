import { describe, expect, it } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { dominantGuild, RaidTracker } from "./raid-tracker.js";

const AREA = 2159;

/** `count` players of one `guild`, named `<prefix><i>` so rosters are distinguishable. */
function guildCrowd(guild: string, count: number, prefix = guild || "pug"): WhoPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i}`,
    guild,
    level: 60,
    classId: 1,
    raceId: 1,
    areaId: AREA,
  }));
}

/** `count` players each in their OWN one-person guild — a pickup raid that won't cluster. */
function scattered(count: number): WhoPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `pug${i}`,
    guild: `guild${i}`,
    level: 60,
    classId: 1,
    raceId: 1,
    areaId: AREA,
  }));
}

describe("RaidTracker (auto grouping — the default)", () => {
  it("stays silent below the forming threshold", () => {
    const tracker = new RaidTracker(15);
    expect(tracker.update(guildCrowd("Nightfall", 14))).toEqual([]);
  });

  it("announces a guild raid when it crosses the threshold", () => {
    const tracker = new RaidTracker(15);
    expect(tracker.update(guildCrowd("Nightfall", 10))).toEqual([]);
    const events = tracker.update(guildCrowd("Nightfall", 16));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "raid-forming", initial: false });
    expect(events[0]?.cohort.label).toBe("<Nightfall>");
    expect(events[0]?.cohort.count).toBe(16);
  });

  it("catches a pickup raid whose members are scattered across guilds", () => {
    const tracker = new RaidTracker(15);
    const events = tracker.update(scattered(16));
    expect(events).toHaveLength(1);
    expect(events[0]?.cohort.label).toBe("a pickup group");
    expect(events[0]?.cohort.count).toBe(16);
  });

  it("tracks a guild raid and a concurrent pickup raid separately", () => {
    const tracker = new RaidTracker(15);
    const events = tracker.update([...guildCrowd("Nightfall", 16), ...scattered(15)]);
    const kinds = events.map((e) => e.cohort.label).sort();
    expect(kinds).toEqual(["<Nightfall>", "a pickup group"]);
  });

  it("fires each transition exactly once, not on every poll", () => {
    const tracker = new RaidTracker(15);
    const roster = guildCrowd("Nightfall", 20);
    expect(tracker.update(roster)).toHaveLength(1); // forming
    // The same raid, poll after poll — nothing more to say.
    expect(tracker.update(roster)).toEqual([]);
    expect(tracker.update(roster)).toEqual([]);
    expect(tracker.update(guildCrowd("Nightfall", 22))).toEqual([]); // grew a bit, still silent
  });

  it("keeps a named guild raid named even when it dips below the threshold", () => {
    const tracker = new RaidTracker(15);
    tracker.update(guildCrowd("Nightfall", 20)); // formed
    tracker.update(guildCrowd("Nightfall", 8)); // dipped, still present — no left, no re-form
    expect(tracker.update(guildCrowd("Nightfall", 25))).toEqual([]);
  });

  it("fires raid-left once, only for the group whose roster empties", () => {
    const tracker = new RaidTracker(15);
    tracker.update([...guildCrowd("Nightfall", 20), ...guildCrowd("Ascend", 18)]);
    const events = tracker.update(guildCrowd("Ascend", 18)); // Nightfall gone
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "raid-left" });
    expect(events[0]?.cohort.key).toBe("Nightfall");
    expect(events[0]?.cohort.count).toBe(0);
    expect(events[0]?.cohort.peak).toBe(20);
  });

  it("is silent through membership churn", () => {
    const tracker = new RaidTracker(15);
    tracker.update(guildCrowd("Nightfall", 20));
    const churned = [...guildCrowd("Nightfall", 18), ...guildCrowd("Nightfall", 2, "newcomer")];
    expect(tracker.update(churned)).toEqual([]);
  });

  it("re-forms after a full clear", () => {
    const tracker = new RaidTracker(15);
    tracker.update(guildCrowd("Nightfall", 20));
    const left = tracker.update([]);
    expect(left).toHaveLength(1);
    expect(left[0]?.kind).toBe("raid-left");
    const again = tracker.update(guildCrowd("Nightfall", 16));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ kind: "raid-forming", initial: false });
  });

  it("marks a raid already in progress on the first poll", () => {
    const tracker = new RaidTracker(15);
    const events = tracker.update(guildCrowd("Nightfall", 18));
    expect(events[0]).toMatchObject({ kind: "raid-forming", initial: true });
  });

  it("re-arms on a drop below the clear floor and fires again — the busy-lair cycle", () => {
    const tracker = new RaidTracker(15, "auto", 5); // leaveAt = 5
    // A pickup raid forms at 17.
    expect(tracker.update(scattered(17)).map((e) => e.kind)).toEqual(["raid-forming"]);
    // It leaves but one straggler remains (1 < 5, not empty) → raid-left + re-arm.
    const left = tracker.update(scattered(1));
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "raid-left" });
    expect(left[0]?.cohort.peak).toBe(17);
    // A new raid builds up to 21 → forms again (not "initial").
    const again = tracker.update(scattered(21));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ kind: "raid-forming", initial: false });
  });

  it("stays active on a dip that holds at or above the clear floor", () => {
    const tracker = new RaidTracker(15, "auto", 5);
    tracker.update(scattered(20));
    expect(tracker.update(scattered(6))).toEqual([]); // 6 >= 5 → still the same raid
    expect(tracker.update(scattered(22))).toEqual([]); // churn back up, still silent
  });

  it("rebaseline absorbs the current lair silently, then re-arms for real transitions", () => {
    const tracker = new RaidTracker(15, "auto", 5);
    tracker.rebaseline(scattered(20)); // post-blackout baseline — emits nothing
    expect(tracker.update(scattered(20))).toEqual([]); // steady → silent (already active)
    const left = tracker.update(scattered(2)); // a real drop still fires
    expect(left.map((e) => e.kind)).toEqual(["raid-left"]);
  });
});

describe("RaidTracker (guild mode)", () => {
  it("keeps a per-guild roster of names", () => {
    const tracker = new RaidTracker(15, "guild");
    tracker.update([...guildCrowd("Nightfall", 3), ...guildCrowd("Ascend", 2)]);
    expect(tracker.rosters.get("Nightfall")).toEqual(["Nightfall0", "Nightfall1", "Nightfall2"]);
    expect(tracker.rosters.get("Ascend")).toEqual(["Ascend0", "Ascend1"]);
  });

  it("does not pool a scattered pickup raid, so it can stay silent", () => {
    const tracker = new RaidTracker(15, "guild");
    expect(tracker.update(scattered(16))).toEqual([]);
  });
});

describe("RaidTracker (lair mode)", () => {
  it("treats the whole lair as one raid regardless of guild", () => {
    const tracker = new RaidTracker(15, "lair");
    const mixed = [...guildCrowd("Nightfall", 8), ...guildCrowd("Ascend", 8)];
    const events = tracker.update(mixed);
    expect(events).toHaveLength(1);
    expect(events[0]?.cohort.count).toBe(16);
    expect(events[0]?.cohort.label).toContain("the lair");
  });
});

describe("dominantGuild", () => {
  it("returns the most common non-empty guild", () => {
    const players = [...guildCrowd("Fortitude", 2), ...guildCrowd("Solo", 1)];
    expect(dominantGuild(players)).toEqual({ guild: "Fortitude", count: 2 });
  });

  it("returns null when nobody has a guild", () => {
    expect(dominantGuild(guildCrowd("", 2, "x"))).toBeNull();
  });
});
