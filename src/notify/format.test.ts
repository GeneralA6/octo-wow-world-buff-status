import { describe, expect, it } from "vitest";
import type { RaidCohortSnapshot } from "../watcher/raid-events.js";
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
  formatHeadIncoming,
  humanClock,
} from "./format.js";

const M = 60_000;

function cohort(over: Partial<RaidCohortSnapshot> = {}): RaidCohortSnapshot {
  return { key: "Nightfall", label: "<Nightfall>", count: 16, peak: 16, members: [], ...over };
}

describe("formatBuffAlert — raid starting", () => {
  it("titles 'Onyxia raid starting', names the raid #, the open capital, and quotes the typical clear", () => {
    const msg = formatBuffAlert({ kind: "raid-forming", initial: false, cohort: cohort(), number: 28 }, ["alliance"], "30-50m");
    expect(msg.title).toBe("🐲 Onyxia raid starting");
    expect(msg.body).toBe("Raid #28 formed, usually 30-50m to clear. Wait in Stormwind for the Rallying Cry buff.");
    expect(msg.body).not.toContain("Orgrimmar");
  });

  it("omits the clear-time clause when no estimate is available", () => {
    const msg = formatBuffAlert({ kind: "raid-forming", initial: false, cohort: cohort(), number: 28 }, ["alliance"]);
    expect(msg.body).toBe("Raid #28 formed. Wait in Stormwind for the Rallying Cry buff.");
  });

  it("falls back to 'A raid' when the formation carries no number, no bare member count", () => {
    const msg = formatBuffAlert({ kind: "raid-forming", initial: false, cohort: cohort() }, ["alliance", "horde"]);
    expect(msg.body).toContain("A raid formed");
    expect(msg.body).toContain("Stormwind or Orgrimmar");
    expect(msg.body).not.toMatch(/\(\d+\)/);
  });
});

describe("formatBuffAlert — raid has ended (merged recap + park CTA)", () => {
  it("titles 'Onyxia raid has ended', carries the # + duration and a hedged park CTA", () => {
    const msg = formatBuffAlert(
      { kind: "raid-left", cohort: cohort({ count: 0 }), number: 28, durationMs: 47 * M },
      ["alliance", "horde"],
    );
    expect(msg.title).toBe("🏁 Onyxia raid has ended");
    expect(msg.body).toBe("Raid #28 cleared after ~47m. Buff may drop in Stormwind or Orgrimmar - wait there now.");
  });

  it("a Chronicle-confirmed clear says Onyxia is down and drops the 'may' hedge", () => {
    const msg = formatBuffAlert(
      { kind: "raid-left", cohort: cohort({ count: 0 }), number: 28, durationMs: 47 * M, killConfirmed: true },
      ["horde"],
    );
    expect(msg.body).toContain("Onyxia down, kill confirmed");
    expect(msg.body).toContain("Buff should drop in Orgrimmar");
    expect(msg.body).not.toMatch(/\bmay\b/);
  });
});

describe("formatBuffWhisper", () => {
  it("starting: names the raid, typical clear, and the open capital", () => {
    const line = formatBuffWhisper({ kind: "raid-forming", initial: false, cohort: cohort(), number: 28 }, ["horde"], "30-50m");
    expect(line).toBe("Onyxia raid starting (Raid #28, usually 30-50m to clear). Wait in Orgrimmar for the Rallying Cry buff.");
  });

  it("ended: plain hedges with 'may', confirmed says the kill", () => {
    const plain = formatBuffWhisper({ kind: "raid-left", cohort: cohort({ count: 0 }) }, ["alliance", "horde"]);
    const confirmed = formatBuffWhisper({ kind: "raid-left", cohort: cohort({ count: 0 }), killConfirmed: true }, ["horde"]);
    expect(plain).toBe("Onyxia raid cleared. Buff may drop in Stormwind or Orgrimmar - wait there now.");
    expect(confirmed).toContain("kill confirmed");
    expect(confirmed).not.toMatch(/\bmay\b/);
  });
});

describe("formatRaidEnding — might end soon", () => {
  it("titles 'might end soon', shows time-in, the typical range, and a park CTA", () => {
    const msg = formatRaidEnding(28, ["alliance"], 28 * M, "30-50m");
    expect(msg.title).toBe("⏰ Onyxia raid might end soon");
    expect(msg.body).toBe("Raid #28 has been in ~28m (typical clear 30-50m). Buff may drop soon - wait in Stormwind now.");
  });

  it("keeps the timing soft — no precise ETA a wide spread would make wrong", () => {
    const msg = formatRaidEnding(28, ["alliance"], 28 * M, "30-50m");
    expect(msg.body).toMatch(/may drop soon/);
    expect(msg.body).not.toMatch(/~\d+m (?:left|to go|until)/i);
  });

  it("the whisper twin names the raid #, time-in, typical, and capital", () => {
    const line = formatRaidEndingWhisper(28, ["horde"], 28 * M, "30-50m");
    expect(line).toBe("Onyxia raid #28 might end soon (~28m in, typical 30-50m). Wait in Orgrimmar now for the buff.");
  });
});

describe("formatRaidDisbanded", () => {
  it("titles 'Onyxia raid disbanded', shows how short it was, and stops parking in the named cities", () => {
    const msg = formatRaidDisbanded(28, ["horde"], 15 * M);
    expect(msg.title).toBe("🚫 Onyxia raid disbanded");
    expect(msg.body).toBe("Raid #28 left after ~15m without clearing. No buff coming. No need to wait in Orgrimmar.");
    expect(msg.body).not.toContain("Stormwind");
  });

  it("omits the duration cleanly when unknown, and names both cities", () => {
    const msg = formatRaidDisbanded(null, ["alliance", "horde"]);
    expect(msg.body).toBe("A raid left without clearing. No buff coming. No need to wait in Stormwind or Orgrimmar.");
  });

  it("the whisper twin says no buff is coming and to stop parking", () => {
    const line = formatRaidDisbandedWhisper(28, ["alliance"], 15 * M);
    expect(line).toBe("Onyxia raid #28 disbanded (left after ~15m). No buff coming. No need to wait in Stormwind.");
  });
});

describe("formatBuffDropped", () => {
  it("titles 'Onyxia buff dropped in <city>' and does NOT repeat it in the body (the title says it)", () => {
    const msg = formatBuffDropped("alliance", "Gibom");
    expect(msg.title).toBe("🎉 Onyxia buff dropped in Stormwind");
    expect(msg.body).not.toMatch(/is up in Stormwind/); // no redundant restatement of the title
    expect(msg.body).not.toMatch(/<t:/); // Discord's own post-time is the drop time; no "N hours ago"
  });

  it("makes NO cooldown / duration claim", () => {
    const msg = formatBuffDropped("horde", "Gibom");
    expect(msg.title).toContain("Orgrimmar");
    expect(msg.body).not.toMatch(/cooldown|2h|wears off|until/i);
  });

  it("carries the same tips line on the channel post and the whisper", () => {
    const tip = "Did you get it? A tip to Gibom is appreciated.";
    expect(formatBuffDropped("alliance", "Gibom").body).toContain(tip);
    expect(formatBuffDroppedWhisper("alliance", "Gibom")).toContain(tip);
  });

  it("saved head explains the origin and drops the tip ask (no credit); fresh keeps the tip", () => {
    const fresh = formatBuffDropped("alliance", "Gibom");
    expect(fresh.body).not.toMatch(/saved|earlier kill|heads-up/i);
    expect(fresh.body).toContain("A tip to Gibom is appreciated"); // fresh still asks
    const saved = formatBuffDropped("alliance", "Gibom", true);
    expect(saved.body).toContain("saved Onyxia head from an earlier kill");
    expect(saved.body).toMatch(/no raid was in the lair/);
    expect(saved.body).not.toMatch(/tip to Gibom|Did you get it/i); // no credit ask on a saved head
    expect(saved.title).toBe(fresh.title); // same headline; only the body differs
  });
});

describe("formatBuffDroppedWhisper", () => {
  it("names the buff and city, with no Discord timestamp (WoW can't render it) and no cooldown claim", () => {
    const line = formatBuffDroppedWhisper("alliance", "Gibom");
    expect(line).toContain("The Rallying Cry of the Dragonslayer just dropped in Stormwind");
    expect(line).not.toMatch(/<t:/);
    expect(line).not.toMatch(/cooldown|2h|at least/i);
  });

  it("appends a short Discord CTA when an invite is given, and omits it otherwise", () => {
    const withCta = formatBuffDroppedWhisper("alliance", "Gibom", "discord.gg/xyz");
    expect(withCta).toContain("Discord is instant: discord.gg/xyz");
    expect(withCta).toMatch(/lag/i); // explains why (server throttle)
    expect(formatBuffDroppedWhisper("alliance", "Gibom")).not.toMatch(/discord/i);
  });

  it("drops the tip ask on a saved head, keeping the buff line and the Discord CTA", () => {
    const saved = formatBuffDroppedWhisper("alliance", "Gibom", "discord.gg/xyz", true);
    expect(saved).toContain("The Rallying Cry of the Dragonslayer just dropped in Stormwind");
    expect(saved).toContain("Discord is instant: discord.gg/xyz");
    expect(saved).not.toMatch(/tip to Gibom|Did you get it/i); // no credit ask on a saved head
    // Fresh keeps the tip.
    expect(formatBuffDroppedWhisper("alliance", "Gibom", "discord.gg/xyz", false)).toContain("A tip to Gibom is appreciated");
  });
});

describe("formatHeadIncoming", () => {
  it("names the incoming city and the park action for an alliance turn-in", () => {
    const msg = formatHeadIncoming("alliance", "Someplayer");
    expect(msg.title).toBe("⚡ Onyxia buff incoming in Stormwind");
    expect(msg.body).toContain("Someplayer");
    expect(msg.body).toMatch(/get to Stormwind now/i);
    expect(msg.body).toMatch(/within moments/i); // it's the ADVANCE warning, not a drop
  });

  it("maps horde to Orgrimmar", () => {
    expect(formatHeadIncoming("horde", "Thrallfan").title).toBe("⚡ Onyxia buff incoming in Orgrimmar");
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
    expect(humanClock(42 * M)).toBe("42m");
    expect(humanClock(120 * M)).toBe("2h");
    expect(humanClock(82 * M)).toBe("1h22m");
    expect(humanClock(-5)).toBe("0m");
  });
});

describe("formatCapitalStatusYell", () => {
  const raid = { number: 834, elapsedMs: 42 * M };

  it("with a raid in: names it, time-in, the typical range, and a park nudge, and no 'cooldown'", () => {
    const y = formatCapitalStatusYell("horde", raid, "30-50m");
    expect(y).toBe(
      `[Onyxia] Onyxia raid in progress (#834, ~42m in, typical clear 30-50m). The Rallying Cry buff may drop soon - wait here. Whisper "subscribe" for pings, "discord" for discord notifications.`,
    );
    expect(y).not.toMatch(/cooldown/i);
  });

  it("no raid in: states how a drop happens", () => {
    const y = formatCapitalStatusYell("alliance", null);
    expect(y).toBe(
      `[Onyxia] No Onyxia raid right now. The Rallying Cry buff drops when a raid clears. Whisper "subscribe" for pings, "discord" for discord notifications.`,
    );
  });

  it("drops the raid number when unknown, keeping the time-in", () => {
    const y = formatCapitalStatusYell("alliance", { number: null, elapsedMs: 12 * M });
    expect(y).not.toMatch(/#\d/);
    expect(y).toContain("~12m in");
    expect(y).toContain("wait here");
  });

  it("stays within the 255-char yell cap even in the busiest state", () => {
    const y = formatCapitalStatusYell("horde", { number: 99999, elapsedMs: 135 * M }, "30-50m");
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
