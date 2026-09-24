import { describe, expect, it } from "vitest";
import { SHAME_JOKES, WARLOCK_CLASS_ID, shameJokesFor } from "./shame-jokes.js";

const WARRIOR = 1;
/** As long a name as the game allows. */
const LONGEST_NAME = "Abcdefghijkl";

describe("SHAME_JOKES", () => {
  it("has thirty jokes: twenty for anyone on the wall, ten about a warlock's Infernal", () => {
    expect(SHAME_JOKES).toHaveLength(30);
    expect(SHAME_JOKES.filter((joke) => joke.warlockOnly)).toHaveLength(10);
  });

  it("names the player in every joke, so they know it's about them", () => {
    for (const joke of SHAME_JOKES) {
      expect(joke.lines("Zezerver").some(([, line]) => line.includes("Zezerver"))).toBe(true);
    }
  });

  it("gives both listeners a part in every joke", () => {
    for (const joke of SHAME_JOKES) {
      expect(new Set(joke.lines("Zezerver").map(([part]) => part))).toEqual(new Set(["a", "b"]));
    }
  });

  it("opens every joke differently", () => {
    const openings = SHAME_JOKES.map((joke) => joke.lines("Zezerver")[0]?.[1]);
    expect(new Set(openings).size).toBe(openings.length);
  });

  it("keeps every line to plain ASCII and one short /say, even for the longest name", () => {
    for (const joke of SHAME_JOKES) {
      for (const [, line] of joke.lines(LONGEST_NAME)) {
        expect(line).toMatch(/^[\x20-\x7e]+$/);
        expect(line.length).toBeLessThanOrEqual(120);
      }
    }
  });
});

describe("shameJokesFor", () => {
  it("offers a warlock every joke", () => {
    expect(shameJokesFor(WARLOCK_CLASS_ID)).toHaveLength(30);
  });

  it("keeps the Infernal jokes from anyone who is not a warlock", () => {
    const fits = shameJokesFor(WARRIOR);
    expect(fits).toHaveLength(20);
    for (const index of fits) expect(SHAME_JOKES[index]?.warlockOnly).toBe(false);
  });
});
