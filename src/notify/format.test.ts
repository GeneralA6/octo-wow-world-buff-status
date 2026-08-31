import { describe, expect, it } from "vitest";
import type { RaidCohortSnapshot } from "../watcher/raid-tracker.js";
import {
  formatBuffAlert,
  formatBuffDropped,
  formatBuffDroppedWhisper,
  formatBuffWhisper,
  formatRaidEvent,
  formatRaidWhisper,
} from "./format.js";

const AREA = "Onyxia's Lair";

function cohort(over: Partial<RaidCohortSnapshot> = {}): RaidCohortSnapshot {
  return { key: "Nightfall", label: "<Nightfall>", count: 16, peak: 16, members: [], ...over };
}

describe("formatBuffAlert", () => {
  it("names the single open capital for a forming raid", () => {
    const message = formatBuffAlert({ kind: "raid-forming", initial: false, cohort: cohort() }, ["alliance"], AREA);
    expect(message.body).toContain("Stormwind");
    expect(message.body).not.toContain("Orgrimmar");
    expect(message.body).toContain("park");
  });

  it("names both capitals when a fresh buff is possible in either", () => {
    const message = formatBuffAlert(
      { kind: "raid-left", cohort: cohort({ count: 0, peak: 25 }) },
      ["alliance", "horde"],
      AREA,
    );
    expect(message.body).toContain("Stormwind or Orgrimmar");
    expect(message.body).toContain("25");
  });
});

describe("formatBuffDropped", () => {
  it("names the city and the exact earliest-next time (drop + duration)", () => {
    const appliedAt = new Date("2026-08-30T20:00:00Z");
    const twoHours = 120 * 60_000;
    const message = formatBuffDropped("alliance", appliedAt, twoHours);
    expect(message.title).toContain("Stormwind");
    expect(message.body).toContain("just dropped in Stormwind");
    expect(message.body).toContain("~2h");
    // expiry = 22:00Z that day -> unix 1788472800
    const expiresUnix = Math.floor((appliedAt.getTime() + twoHours) / 1000);
    expect(message.body).toContain(`<t:${expiresUnix}:t>`);
    expect(message.body).toContain(`<t:${expiresUnix}:R>`);
  });

  it("renders a non-round window as minutes", () => {
    const message = formatBuffDropped("horde", new Date("2026-08-30T20:00:00Z"), 90 * 60_000);
    expect(message.title).toContain("Orgrimmar");
    expect(message.body).toContain("~90 min");
  });
});

describe("formatBuffDroppedWhisper", () => {
  it("names the city and the duration, with NO absolute clock time (the bot's clock isn't the player's)", () => {
    const line = formatBuffDroppedWhisper("alliance", 120 * 60_000);
    expect(line).toContain("Stormwind");
    expect(line).toContain("~2h");
    expect(line).not.toMatch(/\d{1,2}:\d{2}/); // no HH:MM
    expect(line).not.toMatch(/<t:/); // no Discord timestamp (WoW can't render it)
  });
});

describe("formatBuffWhisper", () => {
  it("gives a terse park-in-the-city line naming the open capital", () => {
    const forming = formatBuffWhisper({ kind: "raid-forming", initial: false, cohort: cohort() }, ["horde"], AREA);
    expect(forming).toContain("Orgrimmar");
    const left = formatBuffWhisper(
      { kind: "raid-left", cohort: cohort({ count: 0, peak: 20 }) },
      ["alliance", "horde"],
      AREA,
    );
    expect(left).toContain("Stormwind or Orgrimmar");
  });
});

describe("formatRaidEvent", () => {
  it("announces a forming raid with its label and count", () => {
    const message = formatRaidEvent({ kind: "raid-forming", initial: false, cohort: cohort() }, AREA);
    expect(message.kind).toBe("entered");
    expect(message.title).toBe("🐉 Raid forming in Onyxia's Lair");
    expect(message.body).toContain("<Nightfall>");
    expect(message.body).toContain("16");
    expect(message.body).toContain("about to start");
  });

  it("words an already-in-progress raid differently", () => {
    const message = formatRaidEvent({ kind: "raid-forming", initial: true, cohort: cohort() }, AREA);
    expect(message.title).toBe("🐉 Raid in Onyxia's Lair");
    expect(message.body).toContain("already");
    expect(message.body).not.toContain("about to start");
  });

  it("reports a departed raid with its peak", () => {
    const message = formatRaidEvent(
      { kind: "raid-left", cohort: cohort({ count: 0, peak: 25 }) },
      AREA,
    );
    expect(message.kind).toBe("left");
    expect(message.title).toBe("✅ Raid left Onyxia's Lair");
    expect(message.body).toContain("<Nightfall>");
    expect(message.body).toContain("peaked 25 players");
  });

  it("carries the pickup-bucket label through unchanged", () => {
    const message = formatRaidEvent(
      { kind: "raid-forming", initial: false, cohort: cohort({ key: " pickup", label: "a pickup group" }) },
      AREA,
    );
    expect(message.body).toContain("a pickup group");
    expect(message.body).not.toContain("<");
  });

  it("uses singular wording for a peak of one", () => {
    const message = formatRaidEvent(
      { kind: "raid-left", cohort: cohort({ count: 0, peak: 1 }) },
      AREA,
    );
    expect(message.body).toContain("peaked 1 player");
    expect(message.body).not.toContain("1 players");
  });
});

describe("formatRaidWhisper", () => {
  it("is a single terse line with no markup for a forming raid", () => {
    const line = formatRaidWhisper({ kind: "raid-forming", initial: false, cohort: cohort() }, AREA);
    expect(line).toContain("<Nightfall>");
    expect(line).toContain("about to start");
    expect(line).not.toContain("\n");
  });

  it("words an already-underway raid on the first poll", () => {
    const line = formatRaidWhisper({ kind: "raid-forming", initial: true, cohort: cohort() }, AREA);
    expect(line).toContain("already underway");
  });

  it("announces a departure with its peak", () => {
    const line = formatRaidWhisper({ kind: "raid-left", cohort: cohort({ count: 0, peak: 25 }) }, AREA);
    expect(line).toContain("has left");
    expect(line).toContain("25");
  });
});
