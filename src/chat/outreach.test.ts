import { describe, expect, it } from "vitest";
import { silentLogger } from "../logger.js";
import { Outreach, introLines } from "./outreach.js";
import { InMemoryGreetLedger } from "./greet-ledger.js";

const config = { guildName: "Rage Quit", community: "OctoWoW", guildInviteEnabled: false, author: "Gibom" };

describe("introLines", () => {
  it("names the guild, the community, and mentions recruiting", () => {
    const lines = introLines(config).join(" ");
    expect(lines).toContain("Rage Quit");
    expect(lines).toContain("OctoWoW");
    expect(lines).toMatch(/recruit/i);
  });

  it("credits the author and invites optional gold tips to them", () => {
    const lines = introLines(config).join(" ");
    expect(lines).toContain("made by Gibom");
    expect(lines).toMatch(/gold tips/i);
    // The tip line frames it as optional, never demanded.
    expect(lines).toMatch(/never expected/i);
  });

  it("directs tips to the author by name", () => {
    const tip = introLines(config).find((l) => /gold tips/i.test(l)) ?? "";
    expect(tip).toMatch(/mail them to Gibom/i);
  });

  it("threads the configured author through both the credit and the tip line", () => {
    const lines = introLines({ ...config, author: "Someone" });
    expect(lines.join(" ")).not.toContain("Gibom");
    expect(lines.filter((l) => l.includes("Someone")).length).toBe(2);
  });

  it("points at the Discord invite command but no longer promises DM linking", () => {
    const lines = introLines(config).join(" ");
    expect(lines).toMatch(/discord/i); // the "discord" command that shares the invite link
    // The removed per-user Discord DM linking must not be advertised any more.
    expect(lines).not.toMatch(/DM you|link Discord|offline/i);
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
    expect(whispers.length).toBe(3); // the three intro lines
    await outreach.onListenerContact("RAIDER"); // case-insensitive repeat
    expect(whispers.length).toBe(3); // unchanged
  });

  it("does not greet while the watcher channel is unavailable, then greets once it is", async () => {
    const whispers: string[] = [];
    const outreach = new Outreach(config, new InMemoryGreetLedger(), silentLogger);
    await outreach.onListenerContact("Raider"); // no channel yet → not claimed
    expect(whispers).toEqual([]);
    outreach.setChannel((to) => whispers.push(to), null);
    await outreach.onListenerContact("Raider");
    expect(whispers).toEqual(["Raider", "Raider", "Raider"]);
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
