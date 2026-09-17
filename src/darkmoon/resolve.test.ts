import { describe, expect, it } from "vitest";
import {
  contradictsSchedule,
  LIVE_SIGHTING_MS,
  parityFlip,
  resolveFaire,
  type FaireSighting,
} from "./resolve.js";
import { VANILLA_SCHEDULE, type FaireSchedule } from "./schedule.js";

const schedule: FaireSchedule = VANILLA_SCHEDULE;
const utc = (iso: string): number => Date.parse(iso);

/** Sept 2026's faire runs the 7th-14th and the shipped anchor calls it Elwynn. */
const DURING_SEPT = utc("2026-09-10T12:00:00Z");
const AFTER_SEPT = utc("2026-09-20T12:00:00Z");

const seen = (location: "elwynn" | "mulgore", at: number): FaireSighting => ({
  location,
  sightedAt: at,
  witness: "Someplayer",
});

describe("parityFlip", () => {
  it("has no opinion without a sighting", () => {
    expect(parityFlip(schedule, null)).toBeNull();
  });

  it("is false when a sighting agrees with the calendar", () => {
    expect(parityFlip(schedule, seen("elwynn", DURING_SEPT))).toBe(false);
  });

  it("is true when a sighting contradicts the calendar's zone", () => {
    expect(parityFlip(schedule, seen("mulgore", DURING_SEPT))).toBe(true);
  });

  it("refuses to conclude when the faire was seen outside any calendar week", () => {
    // The week rule itself is wrong, not just the alternation — flipping zones cannot fix that.
    expect(parityFlip(schedule, seen("mulgore", AFTER_SEPT))).toBeNull();
  });
});

describe("resolveFaire", () => {
  describe("with no sighting", () => {
    it("answers from the calendar and admits the location is unconfirmed", () => {
      const report = resolveFaire(schedule, null, DURING_SEPT);
      expect(report.phase).toBe("up");
      expect(report.location).toBe("elwynn");
      expect(report.site.landmark).toBe("south of Goldshire");
      expect(report.source).toBe("calendar");
      expect(report.locationConfirmed).toBe(false);
      expect(report.closesAt).toBe(utc("2026-09-14T00:00:00Z"));
    });

    it("points at the next faire while travelling", () => {
      const report = resolveFaire(schedule, null, AFTER_SEPT);
      expect(report.phase).toBe("travelling");
      expect(report.location).toBe("mulgore");
      expect(report.opensAt).toBe(utc("2026-10-05T00:00:00Z"));
    });
  });

  describe("with a live sighting", () => {
    it("answers from the sighting and keeps the calendar's closing time", () => {
      const sighting = seen("elwynn", DURING_SEPT - 3_600_000);
      const report = resolveFaire(schedule, sighting, DURING_SEPT);
      expect(report.source).toBe("sighting");
      expect(report.location).toBe("elwynn");
      expect(report.closesAt).toBe(utc("2026-09-14T00:00:00Z"));
      expect(report.locationConfirmed).toBe(true);
      expect(report.sighting).toBe(sighting);
    });

    it("beats the calendar on WHERE", () => {
      const report = resolveFaire(schedule, seen("mulgore", DURING_SEPT - 60_000), DURING_SEPT);
      expect(report.location).toBe("mulgore");
      expect(report.site.landmark).toBe("below Thunder Bluff");
      expect(report.source).toBe("sighting");
    });

    it("beats the calendar on WHETHER IT IS UP, and then claims no window", () => {
      // Someone is standing in the tents on a day the vanilla rule says the faire has left.
      const report = resolveFaire(schedule, seen("mulgore", AFTER_SEPT - 60_000), AFTER_SEPT);
      expect(report.phase).toBe("up");
      expect(report.location).toBe("mulgore");
      expect(report.opensAt).toBeNull();
      expect(report.closesAt).toBeNull();
      expect(report.source).toBe("sighting");
    });

    it("stops being live exactly at the staleness bound", () => {
      const inside = resolveFaire(schedule, seen("elwynn", DURING_SEPT - LIVE_SIGHTING_MS), DURING_SEPT);
      expect(inside.source).toBe("sighting");
      const outside = resolveFaire(schedule, seen("elwynn", DURING_SEPT - LIVE_SIGHTING_MS - 1), DURING_SEPT);
      expect(outside.source).toBe("calendar");
    });
  });

  describe("with an old sighting", () => {
    it("still lets one sighting correct the alternation for every later month", () => {
      // One player saw Mulgore in September, so the shipped "September = Elwynn" anchor is upside
      // down — and October, November and every month after it flip with it, forever.
      const sighting = seen("mulgore", DURING_SEPT);
      const october = resolveFaire(schedule, sighting, utc("2026-10-06T12:00:00Z"));
      expect(october.phase).toBe("up");
      expect(october.location).toBe("elwynn");
      expect(october.source).toBe("calendar");
      expect(october.locationConfirmed).toBe(true);

      const november = resolveFaire(schedule, sighting, utc("2026-11-03T12:00:00Z"));
      expect(november.location).toBe("mulgore");
    });

    it("treats a future-dated sighting as history, not as proof the faire is up now", () => {
      const august = resolveFaire(schedule, seen("mulgore", DURING_SEPT), utc("2026-08-04T12:00:00Z"));
      expect(august.location).toBe("elwynn");
    });

    it("leaves the calendar alone when the sighting agreed with it", () => {
      const october = resolveFaire(schedule, seen("elwynn", DURING_SEPT), utc("2026-10-06T12:00:00Z"));
      expect(october.location).toBe("mulgore");
      expect(october.locationConfirmed).toBe(true);
    });

    it("draws no conclusion from a sighting the calendar cannot place", () => {
      const report = resolveFaire(schedule, seen("mulgore", AFTER_SEPT), utc("2026-10-06T12:00:00Z"));
      expect(report.locationConfirmed).toBe(false);
      expect(report.location).toBe("mulgore");
    });
  });
});

describe("contradictsSchedule", () => {
  it("is quiet when the faire was seen during a week the calendar knows about", () => {
    expect(contradictsSchedule(schedule, seen("elwynn", DURING_SEPT))).toBe(false);
    // The wrong zone is not a contradiction — that is the alternation, which corrects itself.
    expect(contradictsSchedule(schedule, seen("mulgore", DURING_SEPT))).toBe(false);
  });

  it("flags a faire seen on a day the rule calls quiet", () => {
    expect(contradictsSchedule(schedule, seen("mulgore", AFTER_SEPT))).toBe(true);
  });
});
