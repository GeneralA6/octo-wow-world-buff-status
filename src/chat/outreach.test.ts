import { describe, expect, it } from "vitest";
import { silentLogger } from "../logger.js";
import { Outreach, introLines, recruitingLine } from "./outreach.js";
import { InMemoryIntroStore } from "./intro-store.js";
import type { Faction } from "../subscribers/store.js";

const config = { guildName: "Rage Quit", community: "OctoWoW", guildInviteEnabled: false, author: "Gibom" };

describe("introLines", () => {
  it("introduces itself, says what it does, and points at subscribe/help", () => {
    const lines = introLines(config).join(" ");
    expect(lines).toMatch(/world-?buff tracker/i);
    expect(lines).toContain("Rallying Cry");
    expect(lines).toMatch(/subscribe/i);
    expect(lines).toMatch(/"help" for more/);
  });

  it("attributes to the guild for the community, and states recruiting", () => {
    const lines = introLines(config).join(" ");
    expect(lines).toContain("Rage Quit"); // the guild running it
    expect(lines).toContain("OctoWoW"); // the community it serves
    expect(lines).toMatch(/recruit/i); // recruiting
    expect(lines).toMatch(/invite/i); // and how to get an invite
  });

  it("keeps it to two whispers and carries no tips (those ride the buff-drop message)", () => {
    const lines = introLines(config);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).not.toMatch(/gold|tip/i);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(255); // client line limit
  });

});

describe("recruitingLine", () => {
  it("names the guild, recruits, and points at the invite command — no subscribe pitch", () => {
    const line = recruitingLine(config);
    expect(line).toContain("Rage Quit");
    expect(line).toMatch(/recruit/i);
    expect(line).toMatch(/invite/i);
    expect(line).not.toMatch(/whisper "subscribe"/i);
  });
});

describe("Outreach", () => {
  function make(cfg = config, subscribed: string[] = []) {
    const whispers: { to: string; msg: string }[] = [];
    const invites: string[] = [];
    const routed: { sender: string; text: string }[] = [];
    const hints: (Faction | null)[] = [];
    const subs = new Set(subscribed.map((n) => n.toLowerCase()));
    const outreach = new Outreach(
      cfg,
      async (name) => subs.has(name.toLowerCase()),
      new InMemoryIntroStore(),
      silentLogger,
    );
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

  const isIntro = (msg: string): boolean => /world-buff tracker/i.test(msg);

  it("introduces itself to a non-subscriber AND routes the message to the command engine", async () => {
    const { outreach, whispers, routed } = make();
    await outreach.onListenerContact("Raider", "hi");
    expect(whispers.some((w) => isIntro(w.msg))).toBe(true); // the onboarding intro
    expect(whispers.some((w) => /whisper "subscribe"/i.test(w.msg))).toBe(true); // pitches subscribe
    expect(whispers.some((w) => w.msg === "reply to hi")).toBe(true); // routed reply
    expect(routed).toEqual([{ sender: "Raider", text: "hi" }]);
  });

  it("a first-contact subscribe gets NO intro — just the reply, then a recruiting follow-up", async () => {
    const { outreach, whispers } = make();
    await outreach.onListenerContact("Raider", "subscribe", "horde"); // their FIRST message is subscribe
    const msgs = whispers.map((w) => w.msg);
    expect(msgs.some((m) => isIntro(m))).toBe(false); // no "I'm the tracker" identity line at all
    const reply = "reply to subscribe"; // the mock stands in for "You're subscribed!"
    const recruit = recruitingLine(config);
    expect(msgs).toContain(reply);
    expect(msgs).toContain(recruit);
    expect(msgs.indexOf(recruit)).toBeGreaterThan(msgs.indexOf(reply)); // recruiting AFTER the confirmation
  });

  it("the confirmation reply is identical whether they subscribe first or after a 'hey'", async () => {
    const confirm = (w: { to: string; msg: string }[]): string[] =>
      w.map((x) => x.msg).filter((m) => m === "reply to subscribe");

    const direct = make(); // first message is subscribe
    await direct.outreach.onListenerContact("Raider", "subscribe", "horde");

    const staged = make(); // "hey" then "subscribe"
    await staged.outreach.onListenerContact("Other", "hey", "horde");
    await staged.outreach.onListenerContact("Other", "subscribe", "horde");

    expect(confirm(direct.whispers)).toEqual(["reply to subscribe"]);
    expect(confirm(staged.whispers)).toEqual(["reply to subscribe"]); // same single confirmation
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

  it("introduces itself ONCE, then keeps answering without re-introducing", async () => {
    const { outreach, whispers, routed } = make();
    await outreach.onListenerContact("Raider", "hi");
    await outreach.onListenerContact("RAIDER", "yo"); // case-insensitive, still not subscribed
    expect(whispers.filter((w) => isIntro(w.msg)).length).toBe(1); // intro only the FIRST time
    expect(routed.map((r) => r.text)).toEqual(["hi", "yo"]); // but both routed and answered
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
    const outreach = new Outreach(config, async () => false, new InMemoryIntroStore(), silentLogger);
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

  it("guild-invites a non-subscriber SILENTLY when enabled — no 'I sent you' whisper", async () => {
    const { outreach, whispers, invites } = make({ ...config, guildInviteEnabled: true });
    await outreach.onListenerContact("Raider", "hi");
    expect(invites).toEqual(["Raider"]); // invited
    // The intro mentions the "invite" command (recruiting), but nothing CONFIRMS one was sent.
    expect(whispers.some((w) => /sent you|i'?ve invited|invited you/i.test(w.msg))).toBe(false);
  });

  it("invites only ONCE, on first contact", async () => {
    const { outreach, invites } = make({ ...config, guildInviteEnabled: true });
    await outreach.onListenerContact("Raider", "hi");
    await outreach.onListenerContact("Raider", "still here"); // second contact
    expect(invites).toEqual(["Raider"]); // not invited again
  });

  it("does not invite when disabled", async () => {
    const { outreach, invites } = make({ ...config, guildInviteEnabled: false });
    await outreach.onListenerContact("Raider", "hi");
    expect(invites).toEqual([]);
  });
});
