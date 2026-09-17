import { describe, expect, it } from "vitest";
import { formatFaire } from "./format.js";
import { FAIRE_SITES } from "./schedule.js";
import type { FaireObservation, FaireReport } from "./resolve.js";

const utc = (iso: string): number => Date.parse(iso);
const NOW = utc("2026-09-10T12:00:00Z");

const seen = (at: number): FaireObservation => ({
  location: "elwynn",
  windowSetupAt: utc("2026-09-04T00:00:00Z"),
  observedAt: at,
  source: "sighting",
  witness: "Someplayer",
});

const report = (over: Partial<FaireReport> = {}): FaireReport => ({
  phase: "up",
  location: "elwynn",
  site: FAIRE_SITES.elwynn,
  setupAt: utc("2026-09-04T00:00:00Z"),
  opensAt: utc("2026-09-07T00:00:00Z"),
  closesAt: utc("2026-09-14T00:00:00Z"),
  source: "calendar",
  confirmedBy: "sighting",
  observation: null,
  ...over,
});

describe("formatFaire", () => {
  it("names the zone and the landmark a player actually rides to", () => {
    expect(formatFaire(report(), NOW)).toBe(
      "Darkmoon Faire is up in Elwynn Forest (south of Goldshire) - closes in ~3d12h.",
    );
  });

  it("says setting up rather than up, so nobody rides out to carnies who won't trade", () => {
    const setup = report({ phase: "setting-up" });
    expect(formatFaire(setup, utc("2026-09-05T12:00:00Z"))).toBe(
      "Darkmoon Faire is setting up in Elwynn Forest (south of Goldshire) - opens in ~1d12h.",
    );
  });

  it("counts down to the next visit while travelling", () => {
    const travelling = report({
      phase: "travelling",
      location: "mulgore",
      site: FAIRE_SITES.mulgore,
      setupAt: utc("2026-10-02T00:00:00Z"),
      opensAt: utc("2026-10-05T00:00:00Z"),
      closesAt: utc("2026-10-12T00:00:00Z"),
    });
    expect(formatFaire(travelling, NOW)).toBe(
      "Darkmoon Faire is travelling. Next stop Mulgore (below Thunder Bluff) in ~24d12h.",
    );
  });

  it("hedges when nothing has ever confirmed the zone", () => {
    expect(formatFaire(report({ confirmedBy: null }), NOW)).toContain("is probably up in");
    expect(formatFaire(report({ confirmedBy: null, phase: "setting-up" }), NOW)).toContain(
      "is probably setting up in",
    );
    expect(formatFaire(report({ confirmedBy: null, phase: "travelling" }), NOW)).toContain(
      "Next stop should be",
    );
  });

  it("does not hedge once a player has actually seen it", () => {
    const live = report({ source: "sighting", confirmedBy: null, observation: seen(NOW - 3_600_000) });
    expect(formatFaire(live, NOW)).toContain("Darkmoon Faire is up in");
  });

  it("dates the sighting when a live sighting leaves no window to quote", () => {
    const live = report({
      source: "sighting",
      setupAt: null,
      opensAt: null,
      closesAt: null,
      observation: seen(NOW - 7_200_000),
    });
    expect(formatFaire(live, NOW)).toBe(
      "Darkmoon Faire is up in Elwynn Forest (south of Goldshire) - last seen ~2h ago.",
    );
  });
});
