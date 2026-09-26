import { describe, expect, it } from "vitest";
import { isAnnounced, yelledInCapitals, type RaidAlertKind } from "./raid-alert-reach.js";

describe("isAnnounced", () => {
  it("sends every raid alert but the start", () => {
    const sent: readonly RaidAlertKind[] = ["raid-ending", "raid-left", "raid-disbanded"];
    for (const kind of sent) expect(isAnnounced(kind)).toBe(true);
    expect(isAnnounced("raid-forming")).toBe(false);
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
