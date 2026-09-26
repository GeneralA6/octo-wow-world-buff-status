import { describe, expect, it } from "vitest";
import { yelledInCapitals, type RaidAlertKind } from "./city-yell.js";

describe("yelledInCapitals", () => {
  it("yells the clear in the capitals — one yell per raid", () => {
    expect(yelledInCapitals("raid-left")).toBe(true);
  });

  it("keeps the start, the 'might end soon' and a disband out of the capitals", () => {
    const quiet: readonly RaidAlertKind[] = ["raid-forming", "raid-ending", "raid-disbanded"];
    for (const kind of quiet) expect(yelledInCapitals(kind)).toBe(false);
  });
});
