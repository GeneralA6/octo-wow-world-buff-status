import { describe, expect, it } from "vitest";
import type { RaidCohortSnapshot } from "../watcher/raid-tracker.js";
import {
  formatBuffAlert,
  formatBuffCooldownRefreshed,
  formatBuffCooldownRefreshedWhisper,
  formatBuffDropped,
  formatBuffDroppedWhisper,
  formatBuffWhisper,
  formatCapitalStatusYell,
  formatFeedbackPost,
  formatRaidEvent,
  formatRaidFinished,
  formatRaidWhisper,
  humanClock,
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
    const message = formatBuffDropped("alliance", appliedAt, twoHours, "Gibom");
    expect(message.title).toContain("Stormwind");
    expect(message.body).toContain("just dropped in Stormwind");
    expect(message.body).toContain("~2h");
    // expiry = 22:00Z that day -> unix 1788472800
    const expiresUnix = Math.floor((appliedAt.getTime() + twoHours) / 1000);
    expect(message.body).toContain(`<t:${expiresUnix}:t>`);
    expect(message.body).toContain(`<t:${expiresUnix}:R>`);
  });

  it("renders a non-round window as minutes", () => {
    const message = formatBuffDropped("horde", new Date("2026-08-30T20:00:00Z"), 90 * 60_000, "Gibom");
    expect(message.title).toContain("Orgrimmar");
    expect(message.body).toContain("~90 min");
  });

  it("carries the same tips line as the whisper (consistent everywhere the drop reaches)", () => {
    const body = formatBuffDropped("alliance", new Date("2026-08-30T20:00:00Z"), 120 * 60_000, "Gibom").body;
    const whisper = formatBuffDroppedWhisper("alliance", 120 * 60_000, "Gibom");
    const tip = "Free to use - a gold tip to Gibom is welcome, never expected.";
    expect(body).toContain(tip);
    expect(whisper).toContain(tip);
  });
});

describe("formatBuffDroppedWhisper", () => {
  it("names the city and the next-window floor, with NO absolute clock time (the bot's clock isn't the player's)", () => {
    const line = formatBuffDroppedWhisper("alliance", 120 * 60_000, "Gibom");
    expect(line).toContain("Stormwind");
    expect(line).toMatch(/at least 2h/);
    expect(line).not.toMatch(/\d{1,2}:\d{2}/); // no HH:MM
    expect(line).not.toMatch(/<t:/); // no Discord timestamp (WoW can't render it)
  });

  it("doesn't overpromise: no 'go grab it', and the next window is a floor ('at least', 'usually longer')", () => {
    const line = formatBuffDroppedWhisper("alliance", 120 * 60_000, "Gibom");
    expect(line).not.toMatch(/go grab/i);
    expect(line).toMatch(/at least/i);
    expect(line).toMatch(/usually longer/i);
  });

  it("names the buff in full, so a reader knows which buff it is", () => {
    expect(formatBuffDroppedWhisper("horde", 120 * 60_000, "Gibom")).toContain("Rallying Cry of the Dragonslayer");
  });
});

describe("formatBuffCooldownRefreshed", () => {
  it("names the city, the full buff, and its Onyxia source so it's unambiguous", () => {
    const message = formatBuffCooldownRefreshed("horde");
    expect(message.title).toContain("Orgrimmar");
    expect(message.title).toContain("Rallying Cry of the Dragonslayer");
    expect(message.body).toContain("Onyxia");
    expect(message.body).toContain("Orgrimmar");
    expect(message.body).not.toContain("Stormwind");
  });

  it("appends a SHORT faction-only nudge by default (rides every ~2h refresh, no unsubscribe)", () => {
    const body = formatBuffCooldownRefreshed("horde").body;
    expect(body).toMatch(/alliance.*horde|horde.*alliance/i);
    expect(body).not.toMatch(/unsubscribe/i); // the full hint (with unsubscribe) is for subscribe, not here
  });

  it("omits the nudge when asked (a DM to a subscriber who already picked a side)", () => {
    const body = formatBuffCooldownRefreshed("horde", false).body;
    expect(body).not.toContain('"alliance"');
    expect(body).toContain("Onyxia"); // the substance is still there
  });
});

describe("humanClock", () => {
  it("renders minutes, hours, and hours+minutes compactly", () => {
    expect(humanClock(42 * 60_000)).toBe("42m");
    expect(humanClock(120 * 60_000)).toBe("2h");
    expect(humanClock(82 * 60_000)).toBe("1h22m");
    expect(humanClock(-5)).toBe("0m"); // never negative
  });
});

describe("formatRaidFinished", () => {
  it("names the raid #, the area, and how long it took", () => {
    const msg = formatRaidFinished(834, 82 * 60_000, "Onyxia's Lair");
    expect(msg.title).toContain("Raid #834");
    expect(msg.body).toContain("Onyxia's Lair");
    expect(msg.body).toContain("~1h22m");
  });

  it("falls back to 'A raid' when unnumbered", () => {
    expect(formatRaidFinished(null, 60 * 60_000, "Onyxia's Lair").title).toContain("A raid");
  });
});

describe("formatCapitalStatusYell", () => {
  const raid = { number: 834, elapsedMs: 42 * 60_000 };

  it("buff up + no raid: cooldown timer + self-promo, and NO raid mention", () => {
    const y = formatCapitalStatusYell("alliance", 72 * 60_000, null, false);
    expect(y).toContain("Rallying Cry cooldown in Stormwind: ~1h12m until a fresh one can drop");
    expect(y).not.toMatch(/raid/i); // no raid → not mentioned at all
    expect(y).toMatch(/subscribe.*discord/);
  });

  it("buff up + raid, but a fresh one can't come in time: raid # shown, NO park nudge", () => {
    const y = formatCapitalStatusYell("horde", 72 * 60_000, raid, false);
    expect(y).toContain("~1h12m until a fresh one can drop");
    expect(y).toContain("raid #834");
    expect(y).toContain("in for ~42m");
    expect(y).not.toMatch(/park here/);
  });

  it("cooldown about to clear + raid: shows the park nudge", () => {
    const y = formatCapitalStatusYell("horde", 15 * 60_000, raid, true);
    expect(y).toContain("~15m until a fresh one can drop");
    expect(y).toMatch(/one may drop when they clear, park here!/);
  });

  it("ready + no raid (idle): JUST the self-promo — no cooldown, no raid", () => {
    const y = formatCapitalStatusYell("alliance", null, null, false);
    expect(y).toBe(`[Onyxia] Whisper Bufftracker "subscribe" for Onyxia buff pings ("discord" for Discord).`);
  });

  it("ready + raid: no cooldown mention, raid + park nudge", () => {
    const y = formatCapitalStatusYell("alliance", null, raid, true);
    expect(y).not.toMatch(/cooldown/i);
    expect(y).toContain("raid #834");
    expect(y).toMatch(/park here!/);
  });

  it("stays within the 255-char yell cap even in the busiest state", () => {
    const y = formatCapitalStatusYell("horde", 119 * 60_000, { number: 99999, elapsedMs: 135 * 60_000 }, true);
    expect(y.length).toBeLessThanOrEqual(255);
  });
});

describe("formatFeedbackPost", () => {
  it("names the sender and includes their message verbatim", () => {
    const post = formatFeedbackPost("Raider", "the timer felt 5 min late");
    expect(post).toContain("Raider");
    expect(post).toContain("the timer felt 5 min late");
    expect(post).toMatch(/suggestion/i);
  });

  it("appends the realm in brackets after the character when given", () => {
    expect(formatFeedbackPost("Raider", "hi", "N'Zoth")).toContain("Raider (N'Zoth)");
  });

  it("omits the brackets when no server is given", () => {
    expect(formatFeedbackPost("Raider", "hi")).not.toContain("(");
  });
});

describe("formatBuffCooldownRefreshedWhisper", () => {
  it("spells out the full buff and its Onyxia source for a city yell, no clock time", () => {
    const line = formatBuffCooldownRefreshedWhisper("alliance");
    expect(line).toContain("Rallying Cry of the Dragonslayer");
    expect(line).toContain("Onyxia");
    expect(line).toContain("Stormwind");
    expect(line).not.toMatch(/<t:/); // WoW can't render Discord timestamps
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
