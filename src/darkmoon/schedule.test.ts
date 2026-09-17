import { describe, expect, it } from "vitest";
import {
  faireStateAt,
  isPresent,
  locationForMonth,
  otherLocation,
  parseFaireAnchor,
  referenceWindow,
  VANILLA_SCHEDULE,
  windowContaining,
  windowForMonth,
  type FaireSchedule,
} from "./schedule.js";

const schedule: FaireSchedule = VANILLA_SCHEDULE;
const utc = (iso: string): number => Date.parse(iso);

describe("windowForMonth", () => {
  it("matches Blizzard's published Classic dates, which the first-Monday rule gets wrong", () => {
    // February 2020 began on a Saturday: the first Monday was the 3rd, but the faire ran the
    // 10th-16th — the Monday AFTER the first Friday (the 7th), which is when setup began.
    const february = windowForMonth(schedule, 2020, 2);
    expect(february.setupAt).toBe(utc("2020-02-07T00:00:00Z"));
    expect(february.opensAt).toBe(utc("2020-02-10T00:00:00Z"));
    expect(february.closesAt).toBe(utc("2020-02-17T00:00:00Z"));
    expect(february.location).toBe("mulgore");

    // March 2020 began on a Sunday: first Monday the 2nd, faire ran the 9th-15th, in Elwynn.
    const march = windowForMonth(schedule, 2020, 3);
    expect(march.opensAt).toBe(utc("2020-03-09T00:00:00Z"));
    expect(march.location).toBe("elwynn");
  });

  it("puts setup and opening a week apart when the month starts on a Monday", () => {
    // 1 March 2027 is a Monday. The first-Monday rule would open the faire on the 1st; the real
    // rule sets up on Friday the 5th and opens on the 8th.
    const window = windowForMonth(schedule, 2027, 3);
    expect(window.setupAt).toBe(utc("2027-03-05T00:00:00Z"));
    expect(window.opensAt).toBe(utc("2027-03-08T00:00:00Z"));
  });

  it("agrees with the first-Monday rule when the month starts Tue-Fri", () => {
    // 1 Sep 2026 is a Tuesday: first Friday the 4th, so it opens Monday the 7th — which is also
    // the first Monday. This is the case that makes the wrong rule look right.
    expect(windowForMonth(schedule, 2026, 9).opensAt).toBe(utc("2026-09-07T00:00:00Z"));
  });

  it("reads day boundaries on the realm clock, not UTC", () => {
    const ahead: FaireSchedule = { ...schedule, utcOffsetMinutes: 120 };
    expect(windowForMonth(ahead, 2026, 9).setupAt).toBe(utc("2026-09-03T22:00:00Z"));
  });

  it("honours a non-vanilla rule without code changes", () => {
    const custom: FaireSchedule = { ...schedule, setupWeekday: 1, occurrence: 2, setupToOpenDays: 0, durationDays: 3 };
    // Second Monday of Sep 2026 is the 14th, opening the same day.
    const window = windowForMonth(custom, 2026, 9);
    expect(window.setupAt).toBe(utc("2026-09-14T00:00:00Z"));
    expect(window.opensAt).toBe(utc("2026-09-14T00:00:00Z"));
    expect(window.closesAt).toBe(utc("2026-09-17T00:00:00Z"));
  });
});

describe("locationForMonth", () => {
  it("returns the anchor's location for the anchor month", () => {
    expect(locationForMonth(schedule, 2020, 2)).toBe("mulgore");
  });

  it("alternates every month after the anchor, across a year boundary", () => {
    expect(locationForMonth(schedule, 2020, 3)).toBe("elwynn");
    expect(locationForMonth(schedule, 2020, 12)).toBe("mulgore");
    expect(locationForMonth(schedule, 2021, 1)).toBe("elwynn");
  });

  it("alternates backwards from the anchor too", () => {
    expect(locationForMonth(schedule, 2020, 1)).toBe("elwynn");
    expect(locationForMonth(schedule, 2019, 12)).toBe("mulgore");
  });

  it("follows the anchor when it is flipped", () => {
    const flipped: FaireSchedule = { ...schedule, anchor: { ...schedule.anchor, location: "elwynn" } };
    expect(locationForMonth(flipped, 2020, 2)).toBe("elwynn");
    expect(locationForMonth(flipped, 2020, 3)).toBe("mulgore");
  });
});

describe("otherLocation", () => {
  it("is its own inverse", () => {
    expect(otherLocation("elwynn")).toBe("mulgore");
    expect(otherLocation(otherLocation("elwynn"))).toBe("elwynn");
  });
});

describe("faireStateAt", () => {
  it("is travelling before setup begins", () => {
    const state = faireStateAt(schedule, utc("2026-09-01T12:00:00Z"));
    expect(state.phase).toBe("travelling");
    expect(state.next.setupAt).toBe(utc("2026-09-04T00:00:00Z"));
  });

  it("is setting up between the carnies arriving and the faire opening", () => {
    const state = faireStateAt(schedule, utc("2026-09-05T12:00:00Z"));
    expect(state.phase).toBe("setting-up");
    expect(isPresent(state)).toBe(true);
    if (!isPresent(state)) throw new Error("expected the faire to be present");
    expect(state.current.opensAt).toBe(utc("2026-09-07T00:00:00Z"));
  });

  it("is present, but not yet up, from the setup instant", () => {
    expect(faireStateAt(schedule, utc("2026-09-04T00:00:00Z")).phase).toBe("setting-up");
  });

  it("is up from the opening instant to the closing instant, exclusive", () => {
    expect(faireStateAt(schedule, utc("2026-09-07T00:00:00Z")).phase).toBe("up");
    expect(faireStateAt(schedule, utc("2026-09-13T23:59:59Z")).phase).toBe("up");
    expect(faireStateAt(schedule, utc("2026-09-14T00:00:00Z")).phase).toBe("travelling");
  });

  it("points at next month once this month's faire has closed", () => {
    const state = faireStateAt(schedule, utc("2026-09-30T23:00:00Z"));
    expect(state.phase).toBe("travelling");
    expect(state.next.opensAt).toBe(utc("2026-10-05T00:00:00Z"));
  });

  it("names the month after as `next` while one is up", () => {
    const state = faireStateAt(schedule, utc("2026-09-10T09:00:00Z"));
    if (!isPresent(state)) throw new Error("expected the faire to be present");
    expect(state.current.location).toBe(otherLocation(state.next.location));
    expect(state.next.opensAt).toBe(utc("2026-10-05T00:00:00Z"));
  });

  it("crosses the year boundary", () => {
    const state = faireStateAt(schedule, utc("2026-12-28T00:00:00Z"));
    expect(state.phase).toBe("travelling");
    expect(state.next.opensAt).toBe(utc("2027-01-04T00:00:00Z"));
  });
});

describe("referenceWindow", () => {
  it("is the faire in the zone while one is there, setup included", () => {
    const setup = faireStateAt(schedule, utc("2026-09-05T09:00:00Z"));
    expect(referenceWindow(setup).opensAt).toBe(utc("2026-09-07T00:00:00Z"));
    const open = faireStateAt(schedule, utc("2026-09-10T09:00:00Z"));
    expect(referenceWindow(open).opensAt).toBe(utc("2026-09-07T00:00:00Z"));
  });

  it("is the coming faire while travelling", () => {
    const state = faireStateAt(schedule, utc("2026-09-20T09:00:00Z"));
    expect(referenceWindow(state).opensAt).toBe(utc("2026-10-05T00:00:00Z"));
  });
});

describe("windowContaining", () => {
  it("returns the window of the month an instant falls in, open or not", () => {
    expect(windowContaining(schedule, utc("2026-09-25T00:00:00Z")).opensAt).toBe(utc("2026-09-07T00:00:00Z"));
    expect(windowContaining(schedule, utc("2026-09-04T00:00:00Z")).setupAt).toBe(utc("2026-09-04T00:00:00Z"));
  });
});

describe("parseFaireAnchor", () => {
  it("reads a well-formed anchor", () => {
    expect(parseFaireAnchor("2020-02:mulgore")).toEqual({ year: 2020, month: 2, location: "mulgore" });
    expect(parseFaireAnchor(" 2026-9:ELWYNN ")).toEqual({ year: 2026, month: 9, location: "elwynn" });
  });

  it("rejects a malformed anchor rather than half-reading it", () => {
    expect(parseFaireAnchor("2026-13:elwynn")).toBeNull();
    expect(parseFaireAnchor("2026-00:elwynn")).toBeNull();
    expect(parseFaireAnchor("2026-09:booty bay")).toBeNull();
    expect(parseFaireAnchor("2026-09")).toBeNull();
    expect(parseFaireAnchor("elwynn")).toBeNull();
    expect(parseFaireAnchor("")).toBeNull();
  });
});
