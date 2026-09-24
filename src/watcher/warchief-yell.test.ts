import { describe, expect, it } from "vitest";
import { matchBuffYell } from "./buff-yell.js";
import { isWarchiefBlessingYell } from "./warchief-yell.js";

const FIRST =
  "Honor your heroes! On this day, they have dealt a great blow against one of our most hated enemies! " +
  "The false Warchief, Rend Blackhand, has fallen!";
const SECOND = "Be bathed in my power! Drink in my might! Battle for the glory of the Horde!";

describe("isWarchiefBlessingYell", () => {
  it("recognises both of Thrall's yells for Rend's head", () => {
    expect(isWarchiefBlessingYell(FIRST)).toBe(true);
    expect(isWarchiefBlessingYell(SECOND)).toBe(true);
  });

  it("does not take the Rallying Cry, or any other yell, for it", () => {
    expect(isWarchiefBlessingYell("People of the Horde, citizens of Orgrimmar! The brood mother, Onyxia, has been slain!")).toBe(false);
    expect(isWarchiefBlessingYell("Latest news from the best race event ever! Come and get your own magazine!")).toBe(false);
  });

  it("is not taken for the Rallying Cry either", () => {
    expect(matchBuffYell(FIRST)).toBeNull();
    expect(matchBuffYell(SECOND)).toBeNull();
  });
});
