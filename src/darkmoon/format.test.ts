import { describe, expect, it } from "vitest";
import { formatFaire } from "./format.js";
import { FAIRE_SITES } from "./schedule.js";
import type { FaireReport } from "./resolve.js";

const NOW = Date.parse("2026-09-10T12:00:00Z");

const report = (over: Partial<FaireReport> = {}): FaireReport => ({
  phase: "up",
  location: "elwynn",
  site: FAIRE_SITES.elwynn,
  opensAt: Date.parse("2026-09-07T00:00:00Z"),
  closesAt: Date.parse("2026-09-14T00:00:00Z"),
  source: "calendar",
  locationConfirmed: true,
  sighting: null,
  ...over,
});

describe("formatFaire", () => {
  it("names the zone and the landmark a player actually rides to", () => {
    expect(formatFaire(report(), NOW)).toBe(
      "Darkmoon Faire is up in Elwynn Forest (south of Goldshire) - closes in ~3d12h.",
    );
  });

  it("counts down to the next visit while travelling", () => {
    expect(
      formatFaire(
        report({
          phase: "travelling",
          location: "mulgore",
          site: FAIRE_SITES.mulgore,
          opensAt: Date.parse("2026-10-05T00:00:00Z"),
          closesAt: Date.parse("2026-10-12T00:00:00Z"),
        }),
        NOW,
      ),
    ).toBe("Darkmoon Faire is travelling. Next stop Mulgore (below Thunder Bluff) in ~24d12h.");
  });

  it("hedges when no sighting has ever confirmed the zone", () => {
    expect(formatFaire(report({ locationConfirmed: false }), NOW)).toContain("is probably up in");
    expect(formatFaire(report({ phase: "travelling", locationConfirmed: false }), NOW)).toContain(
      "Next stop should be",
    );
  });

  it("does not hedge once a player has actually seen it", () => {
    const seen = report({
      source: "sighting",
      locationConfirmed: false,
      sighting: { location: "elwynn", sightedAt: NOW - 3_600_000, witness: "Someplayer" },
    });
    expect(formatFaire(seen, NOW)).toContain("Darkmoon Faire is up in");
  });

  it("dates the sighting when a live sighting leaves the calendar with no window to quote", () => {
    const seen = report({
      source: "sighting",
      opensAt: null,
      closesAt: null,
      sighting: { location: "elwynn", sightedAt: NOW - 7_200_000, witness: "Someplayer" },
    });
    expect(formatFaire(seen, NOW)).toBe(
      "Darkmoon Faire is up in Elwynn Forest (south of Goldshire) - last seen ~2h ago.",
    );
  });
});
