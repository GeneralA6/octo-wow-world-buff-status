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

  it("points at the Discord and help — plain 'Discord', no alliance/horde detail", () => {
    const lines = introLines(config).join(" ");
    expect(lines).toMatch(/posts in Discord/);
    expect(lines).not.toMatch(/OctoWoW Discord/); // not tied to a named server
    expect(lines).toMatch(/"help"/);
    expect(lines).not.toMatch(/alliance|horde|@/i);
  });

  it("is stripped of attribution, recruiting, tips, and the park-fluff", () => {
    const lines = introLines(config).join(" ");
    expect(lines).not.toMatch(/made by|Rage Quit|recruit/i);
    expect(lines).not.toMatch(/gold|tip/i);
    expect(lines).not.toMatch(/park|grab it/i);
    expect(lines).not.toMatch(/DM you|link Discord/i); // and still no removed DM-linking
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
    expect(whispers.length).toBe(2); // the two intro lines
    await outreach.onListenerContact("RAIDER"); // case-insensitive repeat
    expect(whispers.length).toBe(2); // unchanged
  });

  it("does not greet while the watcher channel is unavailable, then greets once it is", async () => {
    const whispers: string[] = [];
    const outreach = new Outreach(config, new InMemoryGreetLedger(), silentLogger);
    await outreach.onListenerContact("Raider"); // no channel yet → not claimed
    expect(whispers).toEqual([]);
    outreach.setChannel((to) => whispers.push(to), null);
    await outreach.onListenerContact("Raider");
    expect(whispers).toEqual(["Raider", "Raider"]);
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
