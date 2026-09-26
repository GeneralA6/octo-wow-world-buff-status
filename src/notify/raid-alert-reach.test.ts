import { describe, expect, it } from "vitest";
import { isDropWhispered, yelledInCapitals, type RaidAlertKind } from "./raid-alert-reach.js";

describe("isDropWhispered", () => {
  it("whispers a drop that followed a raid, but not a saved head's", () => {
    expect(isDropWhispered(false)).toBe(true);
    expect(isDropWhispered(true)).toBe(false);
  });
});

describe("yelledInCapitals", () => {
  it("yells the clear in the capitals — one yell per raid", () => {
    expect(yelledInCapitals("raid-left")).toBe(true);
  });

  it("keeps the start, the 'might end soon' and a disband out of the capitals", () => {
    const quiet: readonly RaidAlertKind[] = ["raid-forming", "raid-ending", "raid-disbanded"];
    for (const kind of quiet) expect(yelledInCapitals(kind)).toBe(false);
  });
});
