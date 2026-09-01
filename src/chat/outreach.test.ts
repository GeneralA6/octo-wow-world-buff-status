import { describe, expect, it } from "vitest";
import { silentLogger } from "../logger.js";
import { Outreach, introLines } from "./outreach.js";
import type { Faction } from "../subscribers/store.js";

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
  function make(cfg = config, subscribed: string[] = []) {
    const whispers: { to: string; msg: string }[] = [];
    const invites: string[] = [];
    const routed: { sender: string; text: string }[] = [];
    const hints: (Faction | null)[] = [];
    const subs = new Set(subscribed.map((n) => n.toLowerCase()));
    const outreach = new Outreach(cfg, async (name) => subs.has(name.toLowerCase()), silentLogger);
    outreach.setChannel(
      (to, msg) => whispers.push({ to, msg }),
      (to) => invites.push(to),
    );
    outreach.setHandler(async (sender, text, sourceFaction) => {
      routed.push({ sender, text });
      hints.push(sourceFaction);
      return [`reply to ${text}`];
    });
    return { outreach, whispers, invites, routed, hints, subs };
  }

  const isIntro = (msg: string): boolean => /World Buff Tracker/.test(msg);

  it("introduces itself to a non-subscriber AND routes the message to the command engine", async () => {
    const { outreach, whispers, routed } = make();
    await outreach.onListenerContact("Raider", "hi");
    expect(whispers.some((w) => isIntro(w.msg))).toBe(true); // the onboarding intro
    expect(whispers.some((w) => w.msg === "reply to hi")).toBe(true); // routed reply
    expect(routed).toEqual([{ sender: "Raider", text: "hi" }]);
  });

  it("forwards the listener's faction to the command engine as the source hint", async () => {
    const { outreach, hints } = make();
    await outreach.onListenerContact("Raider", "subscribe", "horde"); // horde listener
    expect(hints).toEqual(["horde"]);
  });

  it("forwards a null hint when the listener has no faction configured", async () => {
    const { outreach, hints } = make();
    await outreach.onListenerContact("Raider", "subscribe"); // no faction passed
    expect(hints).toEqual([null]);
  });

  it("greets a non-subscriber on EVERY contact — the once-limit is gone", async () => {
    const { outreach, whispers, routed } = make();
    await outreach.onListenerContact("Raider", "hi");
    await outreach.onListenerContact("RAIDER", "yo"); // case-insensitive, still not subscribed
    expect(whispers.filter((w) => isIntro(w.msg)).length).toBe(2); // intro BOTH times
    expect(routed.map((r) => r.text)).toEqual(["hi", "yo"]); // both routed too
  });

  it("does NOT greet a subscriber, but still routes and answers", async () => {
    const { outreach, whispers, routed } = make(config, ["Raider"]); // Raider is subscribed
    await outreach.onListenerContact("Raider", "status");
    expect(whispers.some((w) => isIntro(w.msg))).toBe(false); // no intro for a subscriber
    expect(whispers.some((w) => w.msg === "reply to status")).toBe(true); // still answered
    expect(routed).toEqual([{ sender: "Raider", text: "status" }]);
  });

  it("does nothing while the watcher channel is unavailable, then works once it is", async () => {
    const whispers: string[] = [];
    const routed: string[] = [];
    const outreach = new Outreach(config, async () => false, silentLogger);
    outreach.setHandler(async (_s, t) => {
      routed.push(t);
      return ["ok"];
    });
    await outreach.onListenerContact("Raider", "hi"); // no channel → not greeted, not routed
    expect(whispers).toEqual([]);
    expect(routed).toEqual([]);
    outreach.setChannel((_to, msg) => whispers.push(msg), null);
    await outreach.onListenerContact("Raider", "hi");
    expect(routed).toEqual(["hi"]);
    expect(whispers).toContain("ok");
  });

  it("guild-invites and congratulates a non-subscriber when enabled", async () => {
    const { outreach, whispers, invites } = make({ ...config, guildInviteEnabled: true });
    await outreach.onListenerContact("Raider", "hi");
    expect(invites).toEqual(["Raider"]);
    expect(whispers.some((w) => /invite/i.test(w.msg))).toBe(true);
  });

  it("does not invite when disabled", async () => {
    const { outreach, invites } = make({ ...config, guildInviteEnabled: false });
    await outreach.onListenerContact("Raider", "hi");
    expect(invites).toEqual([]);
  });
});
