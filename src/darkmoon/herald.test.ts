import { describe, expect, it } from "vitest";
import { matchHerald } from "./herald.js";

/** The announcement as the heralds actually word it — note it never names a zone. */
const ANNOUNCEMENT = "The Darkmoon Faire is coming! There is fun for children of ALL ages! Come one, come all!";

describe("matchHerald", () => {
  it("reads the zone off WHO is speaking, since the text never says", () => {
    expect(matchHerald("Kruban Darkblade", ANNOUNCEMENT)).toEqual({
      location: "mulgore",
      herald: "Kruban Darkblade",
      capital: "Orgrimmar",
    });
    expect(matchHerald("Melnan Darkstone", ANNOUNCEMENT)).toEqual({
      location: "elwynn",
      herald: "Melnan Darkstone",
      capital: "Ironforge",
    });
  });

  it("matches the heralds' other lines too", () => {
    for (const line of [
      "The Darkmoon Faire is coming to town! Don't miss it!",
      "Step right up and hear about the most amazing spectacle in all of Azeroth - the Darkmoon Faire! Huzzah!",
      "Be sure to catch all the amazing sights and wonders of the Darkmoon Faire when it comes to town!",
    ]) {
      expect(matchHerald("Kruban Darkblade", line)?.location).toBe("mulgore");
    }
  });

  it("ignores every other NPC in the capital", () => {
    expect(matchHerald("Thrall", ANNOUNCEMENT)).toBeNull();
    expect(matchHerald("Darkmoon Faire Carnie", ANNOUNCEMENT)).toBeNull();
    expect(matchHerald("", ANNOUNCEMENT)).toBeNull();
  });

  it("ignores a herald saying something that is not an announcement", () => {
    // Guards against reading an unrelated line from an NPC who happens to share the name.
    expect(matchHerald("Kruban Darkblade", "Hello there, traveller.")).toBeNull();
    expect(matchHerald("Kruban Darkblade", "")).toBeNull();
  });

  it("is not fooled by a player quoting the announcement — names come from the packet", () => {
    // A player character cannot be the sender of monster chat, so the only guard needed here is
    // that an arbitrary name never matches.
    expect(matchHerald("Kruban", ANNOUNCEMENT)).toBeNull();
    expect(matchHerald("Kruban Darkblade the Second", ANNOUNCEMENT)).toBeNull();
  });
});
