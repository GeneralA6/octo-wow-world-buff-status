import { describe, expect, it } from "vitest";
import { parseIntent } from "./intent.js";

describe("parseIntent", () => {
  const cases: [string, ReturnType<typeof parseIntent>][] = [
    ["sign me up", "subscribe"],
    ["can you notify me", "subscribe"],
    ["count me in!", "subscribe"],
    ["please stop", "unsubscribe"],
    ["unsubscribe me", "unsubscribe"],
    ["remove me from alerts", "unsubscribe"],
    ["how do I join?", "guild"],
    ["are you recruiting", "guild"],
    ["invite me to the guild", "guild"],
    ["when's the buff coming?", "buff"],
    ["is a world buff up", "buff"],
    ["any raid going?", "status"],
    ["what's happening in the lair", "status"],
    ["is onyxia up?", "status"],
    ["who are you?", "help"],
    ["what do you do", "help"],
    ["how does this work", "help"],
    ["?", "help"],
    // new intents
    ["what's your discord?", "discord"],
    ["do you have a discord", "discord"],
    // profile was dropped — these no longer resolve to anything
    ["am i subscribed?", null],
    ["what are my settings", null],
    ["you should add a horde-only mode", "feedback"],
    ["i have a suggestion", "feedback"],
    ["can you add a timer for BWL", "feedback"],
    ["thanks!", "thanks"],
    ["ty so much", "thanks"],
    ["good bot", "thanks"],
    // guard: a buff-timing question mentioning nothing feedback-y stays "buff"
    ["any idea when the buff drops?", "buff"],
    // broader phrasings — buff timing
    ["eta on the buff?", "buff"],
    ["what's the cooldown", "buff"],
    ["cd?", "buff"],
    ["next buff when", "buff"],
    // broader phrasings — subscribe / unsubscribe
    ["sign up", "subscribe"],
    ["register me please", "subscribe"],
    ["hook me up", "subscribe"],
    ["mute me", "unsubscribe"],
    ["turn the alerts off", "unsubscribe"],
    // broader phrasings — guild
    ["who made you?", "guild"],
    ["what guild is this", "guild"],
    ["how do i apply", "guild"],
    // broader phrasings — status
    ["is it raiding", "status"],
    ["raid?", "status"],
    ["anyone running ony", "status"],
    // broader phrasings — thanks / help
    ["nice bot!", "thanks"],
    ["that's awesome", "thanks"],
    ["what commands are there", "help"],
    ["what options do i have", "help"],
    ["asdf random text", null],
    ["", null],
  ];
  for (const [text, expected] of cases) {
    it(`maps ${JSON.stringify(text)} -> ${expected}`, () => {
      expect(parseIntent(text)).toBe(expected);
    });
  }

  it("prefers unsubscribe over subscribe when both could match", () => {
    expect(parseIntent("please unsubscribe me")).toBe("unsubscribe");
  });
});
