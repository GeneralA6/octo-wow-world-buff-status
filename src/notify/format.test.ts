import { describe, expect, it } from "vitest";
import type { RaidCohortSnapshot } from "../watcher/raid-tracker.js";
import {
  formatBuffAlert,
  formatBuffDropped,
  formatBuffDroppedWhisper,
  formatBuffWhisper,
  formatRaidEnding,
  formatRaidEndingWhisper,
  formatRaidDisbanded,
  formatRaidDisbandedWhisper,
  formatCapitalStatusYell,
  formatFeedbackPost,
  formatGuildWelcome,
  formatRaidFinished,
  humanClock,
} from "./format.js";

const AREA = "Onyxia's Lair";

function cohort(over: Partial<RaidCohortSnapshot> = {}): RaidCohortSnapshot {
  return { key: "Nightfall", label: "<Nightfall>", count: 16, peak: 16, members: [], ...over };
}

describe("formatBuffAlert", () => {
  it("names the single open capital for a formed raid", () => {
    const message = formatBuffAlert({ kind: "raid-forming", initial: false, cohort: cohort() }, ["alliance"], AREA);
    expect(message.body).toContain("Stormwind");
    expect(message.body).not.toContain("Orgrimmar");
    expect(message.body).toContain("park");
    expect(message.body).toContain("has formed");
  });

  it("names the raid by its number when the formation carries one", () => {
    const message = formatBuffAlert(
      { kind: "raid-forming", initial: false, cohort: cohort(), number: 28 },
      ["alliance"],
      AREA,
    );
    expect(message.body).toContain("Raid #28 has formed");
    expect(message.body).not.toMatch(/\(\d+\)/); // no bare member-count in parens
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

  it("a plain (inferred) clear hedges with 'may' and does NOT claim a kill", () => {
    const message = formatBuffAlert({ kind: "raid-left", cohort: cohort({ count: 0, peak: 25 }) }, ["horde"], AREA);
    expect(message.title).toContain("may drop");
    expect(message.body).not.toMatch(/kill confirmed|downed Onyxia/i);
  });

  it("a Chronicle-confirmed clear says the Onyxia kill is confirmed and drops the hedge", () => {
    const message = formatBuffAlert(
      { kind: "raid-left", cohort: cohort({ count: 0, peak: 25 }), killConfirmed: true },
      ["horde"],
      AREA,
    );
    expect(message.title).not.toMatch(/may/i);
    expect(message.body).toContain("kill confirmed");
    expect(message.body).toContain("Onyxia");
    expect(message.body).toContain("Orgrimmar");
  });

  it("the whisper mirrors it: confirmed says the kill, plain says 'possible'", () => {
    const plain = formatBuffWhisper({ kind: "raid-left", cohort: cohort({ count: 0, peak: 25 }) }, ["horde"], AREA);
    const confirmed = formatBuffWhisper(
      { kind: "raid-left", cohort: cohort({ count: 0, peak: 25 }), killConfirmed: true },
      ["horde"],
      AREA,
    );
    expect(plain).toContain("possible Rallying Cry");
    expect(confirmed).toContain("kill confirmed");
    expect(confirmed).not.toContain("possible");
  });
});

describe("formatBuffDropped", () => {
  it("titles the buff up in the city and carries a live relative timestamp of the drop", () => {
    const appliedAt = new Date("2026-08-30T20:00:00Z");
    const message = formatBuffDropped("alliance", appliedAt, "Gibom");
    expect(message.title).toBe("🎉 Rallying Cry just dropped in Stormwind");
    expect(message.body).toContain("is up in Stormwind");
    const droppedUnix = Math.floor(appliedAt.getTime() / 1000);
    expect(message.body).toContain(`<t:${droppedUnix}:R>`); // when it dropped, live in each timezone
  });

  it("makes NO cooldown / duration claim — we track drops, not the buff on players", () => {
    const message = formatBuffDropped("horde", new Date("2026-08-30T20:00:00Z"), "Gibom");
    expect(message.title).toContain("Orgrimmar");
    expect(message.body).not.toMatch(/cooldown|2h|wears off|until/i);
  });

  it("carries the same tips line as the whisper (consistent everywhere the drop reaches)", () => {
    const body = formatBuffDropped("alliance", new Date("2026-08-30T20:00:00Z"), "Gibom").body;
    const whisper = formatBuffDroppedWhisper("alliance", "Gibom");
    const tip = "Did you get it? A tip to Gibom is appreciated.";
    expect(body).toContain(tip);
    expect(whisper).toContain(tip);
  });
});

describe("formatBuffDroppedWhisper", () => {
  it("names the city, no absolute clock time and no Discord timestamp (the bot's clock isn't the player's)", () => {
    const line = formatBuffDroppedWhisper("alliance", "Gibom");
    expect(line).toContain("Stormwind");
    expect(line).not.toMatch(/\d{1,2}:\d{2}/); // no HH:MM
    expect(line).not.toMatch(/<t:/); // no Discord timestamp (WoW can't render it)
  });

  it("makes no cooldown claim; says the next one will be alerted", () => {
    const line = formatBuffDroppedWhisper("alliance", "Gibom");
    expect(line).not.toMatch(/cooldown|at least|2h/i);
    expect(line).toMatch(/alert you when the next/i);
  });

  it("names the buff in full, so a reader knows which buff it is", () => {
    expect(formatBuffDroppedWhisper("horde", "Gibom")).toContain("Rallying Cry of the Dragonslayer");
  });
});

describe("formatGuildWelcome", () => {
  it("welcomes the member by name, on one line, without naming the guild", () => {
    const line = formatGuildWelcome("Raider");
    expect(line).toContain("Raider");
    expect(line).toMatch(/welcome/i);
    expect(line).not.toContain("\n");
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

  it("always promises a fresh drop may come (every clear can drop one — no lockout)", () => {
    const msg = formatRaidFinished(1, 60 * 60_000, "Onyxia's Lair");
    expect(msg.body).toContain("may drop soon");
    expect(msg.body).not.toContain("already up"); // no buff-state model any more
  });
});

describe("formatRaidEnding", () => {
  it("names the raid, how long it's been in, the open capital, and a park-now CTA", () => {
    const msg = formatRaidEnding(28, ["alliance"], 28 * 60_000, "Onyxia's Lair");
    expect(msg.title).toContain("⏰");
    expect(msg.title).toContain("Raid #28");
    expect(msg.body).toContain("~28m");
    expect(msg.body).toContain("Stormwind");
    expect(msg.body).not.toContain("Orgrimmar");
    expect(msg.body).toMatch(/park now/i);
  });

  it("keeps the timing soft — no precise ETA that a wide spread would make wrong", () => {
    const msg = formatRaidEnding(28, ["alliance"], 28 * 60_000, "Onyxia's Lair");
    expect(msg.body).toMatch(/should drop.*soon/i);
    expect(msg.body).not.toMatch(/~\d+m (?:left|to go|until)/i); // no "~10m left" promise
  });

  it("names both capitals when either could get it, and falls back to 'A raid' unnumbered", () => {
    const msg = formatRaidEnding(null, ["alliance", "horde"], 30 * 60_000, "Onyxia's Lair");
    expect(msg.title).toContain("A raid");
    expect(msg.body).toContain("Stormwind or Orgrimmar");
  });

  it("the whisper twin names the raid, time in, capital, and 'about to clear'", () => {
    const line = formatRaidEndingWhisper(28, ["horde"], 28 * 60_000, "Onyxia's Lair");
    expect(line).toContain("Raid #28");
    expect(line).toContain("~28m");
    expect(line).toContain("Orgrimmar");
    expect(line).toMatch(/about to clear/i);
  });
});

describe("formatRaidDisbanded", () => {
  it("names the raid, says it didn't clear, and tells the named cities to stop parking", () => {
    const msg = formatRaidDisbanded(28, ["horde"], "Onyxia's Lair");
    expect(msg.title).toContain("🚫");
    expect(msg.title).toContain("Raid #28");
    expect(msg.body).toMatch(/without clearing/i);
    expect(msg.body).toMatch(/no Rallying Cry coming/i);
    expect(msg.body).toContain("Orgrimmar");
    expect(msg.body).not.toContain("Stormwind"); // only the city that was told to park
  });

  it("names both cities when both were told to park, and falls back to 'The raid' unnumbered", () => {
    const msg = formatRaidDisbanded(null, ["alliance", "horde"], "Onyxia's Lair");
    expect(msg.title).toContain("The raid");
    expect(msg.body).toContain("Stormwind or Orgrimmar");
  });

  it("the whisper twin says no buff is coming and to stop parking", () => {
    const line = formatRaidDisbandedWhisper(28, ["alliance"], "Onyxia's Lair");
    expect(line).toContain("Raid #28");
    expect(line).toMatch(/no buff coming/i);
    expect(line).toMatch(/stop parking in Stormwind/i);
  });
});

describe("formatCapitalStatusYell", () => {
  const raid = { number: 834, elapsedMs: 42 * 60_000 };

  it("names the buff and, with a raid in the lair, shows its number, time in, and a park nudge", () => {
    const y = formatCapitalStatusYell("horde", raid);
    expect(y).toContain("Rallying Cry world buff:"); // named up front, no longer vague
    expect(y).toContain("raid #834");
    expect(y).toContain("in for ~42m");
    expect(y).toMatch(/one may drop when they clear, park here!/);
    expect(y).toMatch(/subscribe.*discord/);
  });

  it("makes no cooldown/timer claim at all — we track drops, not the buff on players", () => {
    expect(formatCapitalStatusYell("horde", raid)).not.toMatch(/cooldown/i);
    expect(formatCapitalStatusYell("alliance", null)).not.toMatch(/cooldown/i);
  });

  it("no raid in: says how a drop happens, no dangling 'world buff:' colon before the CTA", () => {
    const y = formatCapitalStatusYell("alliance", null);
    expect(y).toBe(
      `[Onyxia] Rallying Cry world buff: a fresh one drops when a raid clears Onyxia. No raid in the lair right now. Whisper "subscribe" for pings, "discord" for discord notifications.`,
    );
    expect(y).not.toMatch(/world buff: Whisper/); // the broken/truncated state
  });

  it("drops the raid number when it isn't known, keeping the time in", () => {
    const y = formatCapitalStatusYell("alliance", { number: null, elapsedMs: 12 * 60_000 });
    expect(y).not.toMatch(/raid #/);
    expect(y).toContain("in for ~12m");
    expect(y).toMatch(/park here!/);
  });

  it("stays within the 255-char yell cap even in the busiest state", () => {
    const y = formatCapitalStatusYell("horde", { number: 99999, elapsedMs: 135 * 60_000 });
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

describe("formatBuffWhisper", () => {
  it("gives a terse park-in-the-city line naming the open capital, with the raid number", () => {
    const forming = formatBuffWhisper(
      { kind: "raid-forming", initial: false, cohort: cohort(), number: 28 },
      ["horde"],
      AREA,
    );
    expect(forming).toContain("Orgrimmar");
    expect(forming).toContain("Raid #28 has formed");
    const left = formatBuffWhisper(
      { kind: "raid-left", cohort: cohort({ count: 0, peak: 20 }) },
      ["alliance", "horde"],
      AREA,
    );
    expect(left).toContain("Stormwind or Orgrimmar");
  });
});
