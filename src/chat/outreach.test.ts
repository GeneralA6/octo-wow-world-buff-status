import { describe, expect, it } from "vitest";
import { silentLogger } from "../logger.js";
import { Outreach, introLines } from "./outreach.js";
import { InMemoryGreetLedger } from "./greet-ledger.js";

const config = { guildName: "Rage Quit", community: "OctoWoW", guildInviteEnabled: false, author: "Gibom" };

describe("introLines", () => {
  it("identifies as the community world buff tracker and says, concisely, what it does", () => {
    const lines = introLines(config).join(" ");
    expect(lines).toContain("OctoWoW-Community World Buff Tracker");
    expect(lines).toMatch(/alert you before/i); // "alert", not "warn"
    expect(lines).toContain("Onyxia Rallying Cry");
    expect(lines).toMatch(/subscribe/i);
  });

  it("is a single line pointing only at 'help' for more — no Discord in the onboarding", () => {
    const lines = introLines(config);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/"help" for more/);
    expect(lines[0]).not.toMatch(/discord/i);
    expect(lines[0]).not.toMatch(/alliance|horde|@/i);
  });

  it("is stripped of attribution, recruiting, tips, and the park-fluff", () => {
    const lines = introLines(config).join(" ");
    expect(lines).not.toMatch(/made by|Rage Quit|recruit/i);
    expect(lines).not.toMatch(/gold|tip/i);
    expect(lines).not.toMatch(/park|grab it/i);
    expect(lines).not.toMatch(/DM you|link Discord/i);
  });
});

describe("Outreach", () => {
  function make(cfg = config) {
    const whispers: { to: string; msg: string }[] = [];
    const invites: string[] = [];
    const outreach = new Outreach(cfg, new InMemoryGreetLedger(), silentLogger);
    outreach.setChannel(
      (to, msg) => whispers.push({ to, msg }),
      (to) => invites.push(to),
    );
    return { outreach, whispers, invites };
  }

  it("greets a player once and not again", async () => {
    const { outreach, whispers } = make();
    await outreach.onListenerContact("Raider");
    expect(whispers.length).toBe(1); // the single intro line
    await outreach.onListenerContact("RAIDER"); // case-insensitive repeat
    expect(whispers.length).toBe(1); // unchanged
  });

  it("does not greet while the watcher channel is unavailable, then greets once it is", async () => {
    const whispers: string[] = [];
    const outreach = new Outreach(config, new InMemoryGreetLedger(), silentLogger);
    await outreach.onListenerContact("Raider"); // no channel yet → not claimed
    expect(whispers).toEqual([]);
    outreach.setChannel((to) => whispers.push(to), null);
    await outreach.onListenerContact("Raider");
    expect(whispers).toEqual(["Raider"]);
  });

  it("guild-invites and congratulates when enabled", async () => {
    const { outreach, whispers, invites } = make({ ...config, guildInviteEnabled: true });
    await outreach.onListenerContact("Raider");
    expect(invites).toEqual(["Raider"]);
    expect(whispers.some((w) => /invite/i.test(w.msg))).toBe(true);
  });

  it("does not invite when disabled", async () => {
    const { outreach, invites } = make({ ...config, guildInviteEnabled: false });
    await outreach.onListenerContact("Raider");
    expect(invites).toEqual([]);
  });
});
