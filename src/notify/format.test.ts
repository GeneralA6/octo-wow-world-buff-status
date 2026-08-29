import { describe, expect, it } from "vitest";
import type { RaidCohortSnapshot } from "../watcher/raid-tracker.js";
import { formatRaidEvent, formatRaidWhisper } from "./format.js";

const AREA = "Onyxia's Lair";

function cohort(over: Partial<RaidCohortSnapshot> = {}): RaidCohortSnapshot {
  return { key: "Nightfall", label: "<Nightfall>", count: 16, peak: 16, members: [], ...over };
}

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
