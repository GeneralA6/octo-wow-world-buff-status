import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../logger.js";
import { Outreach, introLines } from "./outreach.js";

const config = { guildName: "Rage Quit", community: "OctoWoW", guildInviteEnabled: false };

describe("introLines", () => {
  it("names the guild, the community, and mentions recruiting", () => {
    const lines = introLines(config).join(" ");
    expect(lines).toContain("Rage Quit");
    expect(lines).toContain("OctoWoW");
    expect(lines).toMatch(/recruit/i);
  });
});

describe("Outreach", () => {
  function make(cfg = config) {
    const whispers: { to: string; msg: string }[] = [];
    const invites: string[] = [];
    const outreach = new Outreach(cfg, silentLogger);
    outreach.setChannel(
      (to, msg) => whispers.push({ to, msg }),
      (to) => invites.push(to),
    );
    return { outreach, whispers, invites };
  }

  it("greets a player once and not again", () => {
    const { outreach, whispers } = make();
    outreach.onListenerContact("Raider");
    expect(whispers.length).toBe(2); // the two intro lines
    expect(outreach.hasGreeted("raider")).toBe(true);
    outreach.onListenerContact("RAIDER"); // case-insensitive repeat
    expect(whispers.length).toBe(2); // unchanged
  });

  it("does not greet while the watcher channel is unavailable, then greets once it is", () => {
    const whispers: string[] = [];
    const outreach = new Outreach(config, silentLogger);
    outreach.onListenerContact("Raider"); // no channel yet
    expect(outreach.hasGreeted("Raider")).toBe(false);
    outreach.setChannel((to) => whispers.push(to), null);
    outreach.onListenerContact("Raider");
    expect(outreach.hasGreeted("Raider")).toBe(true);
    expect(whispers).toEqual(["Raider", "Raider"]);
  });

  it("guild-invites and congratulates when enabled", () => {
    const { outreach, whispers, invites } = make({ ...config, guildInviteEnabled: true });
    outreach.onListenerContact("Raider");
    expect(invites).toEqual(["Raider"]);
    expect(whispers.some((w) => /invite/i.test(w.msg))).toBe(true);
  });

  it("does not invite when disabled", () => {
    const { outreach, invites } = make({ ...config, guildInviteEnabled: false });
    outreach.onListenerContact("Raider");
    expect(invites).toEqual([]);
  });
});
