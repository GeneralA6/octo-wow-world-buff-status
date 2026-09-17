import { describe, expect, it } from "vitest";
import {
  anchorHerald,
  anchorSighting,
  contradictsSchedule,
  LIVE_SIGHTING_MS,
  NO_KNOWLEDGE,
  parityFlip,
  resolveFaire,
  type FaireKnowledge,
  type FaireObservation,
} from "./resolve.js";
import { VANILLA_SCHEDULE, type FaireSchedule } from "./schedule.js";

const schedule: FaireSchedule = VANILLA_SCHEDULE;
const utc = (iso: string): number => Date.parse(iso);

/** September 2026: sets up Fri the 4th, open the 7th-14th, and the shipped anchor calls it Elwynn. */
const SETUP_SEPT = utc("2026-09-05T12:00:00Z");
const DURING_SEPT = utc("2026-09-10T12:00:00Z");
const AFTER_SEPT = utc("2026-09-20T12:00:00Z");

const sighting = (location: "elwynn" | "mulgore", at: number): FaireObservation => {
  const observation = anchorSighting(schedule, location, at, "Someplayer");
  if (observation === null) throw new Error("fixture sighting could not be anchored");
  return observation;
};
const herald = (location: "elwynn" | "mulgore", at: number): FaireObservation =>
  anchorHerald(schedule, location, at, "Kruban Darkblade");

const knows = (over: Partial<FaireKnowledge> = {}): FaireKnowledge => ({ ...NO_KNOWLEDGE, ...over });

describe("anchorSighting", () => {
  it("anchors to the window whose tents the witness was standing in", () => {
    expect(sighting("elwynn", DURING_SEPT).windowSetupAt).toBe(utc("2026-09-04T00:00:00Z"));
  });

  it("anchors a sighting made during setup to that same window", () => {
    // The tents are up three days before the faire opens, so this is a normal sighting, not a bug.
    expect(sighting("elwynn", SETUP_SEPT).windowSetupAt).toBe(utc("2026-09-04T00:00:00Z"));
  });

  it("refuses to anchor a sighting made when the calendar says the faire is away", () => {
    expect(anchorSighting(schedule, "elwynn", AFTER_SEPT, "Someplayer")).toBeNull();
  });
});

describe("anchorHerald", () => {
  it("anchors to the faire being announced — always the next one", () => {
    const before = herald("elwynn", utc("2026-09-01T12:00:00Z"));
    expect(before.windowSetupAt).toBe(utc("2026-09-04T00:00:00Z"));
  });

  it("anchors to the following month once this month's faire has been and gone", () => {
    expect(herald("mulgore", AFTER_SEPT).windowSetupAt).toBe(utc("2026-10-02T00:00:00Z"));
  });

  it("anchors to next month even if heard while a faire is up", () => {
    expect(herald("mulgore", DURING_SEPT).windowSetupAt).toBe(utc("2026-10-02T00:00:00Z"));
  });
});

describe("contradictsSchedule", () => {
  it("is quiet for any moment the faire is in the zone, setup included", () => {
    expect(contradictsSchedule(schedule, SETUP_SEPT)).toBe(false);
    expect(contradictsSchedule(schedule, DURING_SEPT)).toBe(false);
  });

  it("flags a moment the rule says the faire is away", () => {
    expect(contradictsSchedule(schedule, AFTER_SEPT)).toBe(true);
  });
});

describe("parityFlip", () => {
  it("has no opinion without an observation", () => {
    expect(parityFlip(schedule, NO_KNOWLEDGE)).toBeNull();
  });

  it("is false when an observation agrees with the calendar", () => {
    expect(parityFlip(schedule, knows({ sighting: sighting("elwynn", DURING_SEPT) }))).toBe(false);
  });

  it("is true when an observation contradicts the calendar's zone", () => {
    expect(parityFlip(schedule, knows({ sighting: sighting("mulgore", DURING_SEPT) }))).toBe(true);
  });

  it("believes the herald over the sighting, because a sighting can be typed by anyone", () => {
    const conflicted = knows({
      herald: herald("elwynn", utc("2026-09-01T12:00:00Z")),
      sighting: sighting("mulgore", DURING_SEPT),
    });
    // Both describe September. The herald says Elwynn, which is what the calendar already thinks.
    expect(parityFlip(schedule, conflicted)).toBe(false);
  });
});

describe("resolveFaire", () => {
  describe("with nothing observed", () => {
    it("answers from the calendar and admits the zone is unconfirmed", () => {
      const report = resolveFaire(schedule, NO_KNOWLEDGE, DURING_SEPT);
      expect(report.phase).toBe("up");
      expect(report.location).toBe("elwynn");
      expect(report.site.landmark).toBe("south of Goldshire");
      expect(report.source).toBe("calendar");
      expect(report.confirmedBy).toBeNull();
      expect(report.closesAt).toBe(utc("2026-09-14T00:00:00Z"));
    });

    it("reports the setup days as setting up, not as up", () => {
      const report = resolveFaire(schedule, NO_KNOWLEDGE, SETUP_SEPT);
      expect(report.phase).toBe("setting-up");
      expect(report.opensAt).toBe(utc("2026-09-07T00:00:00Z"));
    });

    it("points at the next faire while travelling", () => {
      const report = resolveFaire(schedule, NO_KNOWLEDGE, AFTER_SEPT);
      expect(report.phase).toBe("travelling");
      expect(report.location).toBe("mulgore");
      expect(report.opensAt).toBe(utc("2026-10-05T00:00:00Z"));
    });
  });

  describe("with a live sighting", () => {
    it("answers from the sighting and keeps the calendar's clock", () => {
      const seen = sighting("elwynn", DURING_SEPT - 3_600_000);
      const report = resolveFaire(schedule, knows({ sighting: seen }), DURING_SEPT);
      expect(report.source).toBe("sighting");
      expect(report.closesAt).toBe(utc("2026-09-14T00:00:00Z"));
      expect(report.confirmedBy).toBe("sighting");
      expect(report.sighting).toBe(seen);
    });

    it("lets the calendar say it is still only setting up", () => {
      const report = resolveFaire(schedule, knows({ sighting: sighting("elwynn", SETUP_SEPT) }), SETUP_SEPT);
      expect(report.phase).toBe("setting-up");
      expect(report.source).toBe("sighting");
    });

    it("beats the calendar on WHERE", () => {
      const seen = sighting("mulgore", DURING_SEPT - 60_000);
      const report = resolveFaire(schedule, knows({ sighting: seen }), DURING_SEPT);
      expect(report.location).toBe("mulgore");
      expect(report.site.landmark).toBe("below Thunder Bluff");
    });

    it("stops being live exactly at the staleness bound", () => {
      const seen = sighting("elwynn", DURING_SEPT - LIVE_SIGHTING_MS);
      expect(resolveFaire(schedule, knows({ sighting: seen }), DURING_SEPT).source).toBe("sighting");
      const stale = sighting("elwynn", DURING_SEPT - LIVE_SIGHTING_MS - 1);
      expect(resolveFaire(schedule, knows({ sighting: stale }), DURING_SEPT).source).toBe("calendar");
    });

    it("treats a future-dated sighting as history, not proof the faire is up now", () => {
      const future = sighting("mulgore", DURING_SEPT);
      const report = resolveFaire(schedule, knows({ sighting: future }), SETUP_SEPT);
      expect(report.source).toBe("calendar");
    });
  });

  describe("with only old observations", () => {
    it("lets one sighting correct the alternation for every later month, forever", () => {
      // One player saw Mulgore in September, so the shipped anchor is upside down — and October,
      // November and every month after it flip with it.
      const knowledge = knows({ sighting: sighting("mulgore", DURING_SEPT) });
      const october = resolveFaire(schedule, knowledge, utc("2026-10-06T12:00:00Z"));
      expect(october.phase).toBe("up");
      expect(october.location).toBe("elwynn");
      expect(october.source).toBe("calendar");
      expect(october.confirmedBy).toBe("sighting");

      expect(resolveFaire(schedule, knowledge, utc("2026-11-04T12:00:00Z")).location).toBe("mulgore");
    });

    it("lets a herald do the same, and says so", () => {
      // Kruban wandering Orgrimmar in early September means September is Mulgore, not Elwynn.
      const knowledge = knows({ herald: herald("mulgore", utc("2026-09-01T12:00:00Z")) });
      const report = resolveFaire(schedule, knowledge, DURING_SEPT);
      expect(report.location).toBe("mulgore");
      expect(report.confirmedBy).toBe("herald");
    });

    it("leaves the calendar alone when the observation agreed with it", () => {
      const knowledge = knows({ sighting: sighting("elwynn", DURING_SEPT) });
      expect(resolveFaire(schedule, knowledge, utc("2026-10-06T12:00:00Z")).location).toBe("mulgore");
    });
  });
});
