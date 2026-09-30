import { describe, expect, it } from "vitest";
import { isDropWhispered, yelledInCapitals, type RaidAlertKind } from "./raid-alert-reach.js";

describe("isDropWhispered", () => {
  it("whispers a drop that followed a raid, but not a saved head's", () => {
    expect(isDropWhispered(false)).toBe(true);
    expect(isDropWhispered(true)).toBe(false);
  });
});

describe("yelledInCapitals", () => {
  it("yells the start, the 'might end soon' and the clear in the capitals", () => {
    const yelled: readonly RaidAlertKind[] = ["raid-forming", "raid-ending", "raid-left"];
    for (const kind of yelled) expect(yelledInCapitals(kind)).toBe(true);
  });

  it("keeps a disband out of the capitals", () => {
    expect(yelledInCapitals("raid-disbanded")).toBe(false);
  });
});
