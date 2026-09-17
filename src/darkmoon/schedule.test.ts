import { describe, expect, it } from "vitest";
import {
  faireStateAt,
  locationForMonth,
  otherLocation,
  referenceWindow,
  VANILLA_SCHEDULE,
  windowForMonth,
  type FaireSchedule,
} from "./schedule.js";

/** UTC realm clock, anchored on September 2026 = Elwynn, so every case reads off one fixed point. */
const schedule: FaireSchedule = VANILLA_SCHEDULE;

const utc = (iso: string): number => Date.parse(iso);

describe("windowForMonth", () => {
  it("opens at realm midnight on the first Monday and runs seven days", () => {
    // 1 Sep 2026 is a Tuesday, so the first Monday is the 7th.
    const window = windowForMonth(schedule, 2026, 9);
    expect(window.opensAt).toBe(utc("2026-09-07T00:00:00Z"));
    expect(window.closesAt).toBe(utc("2026-09-14T00:00:00Z"));
  });

  it("opens on the 1st when the month itself starts on the opening weekday", () => {
    // 1 Mar 2027 is a Monday — the zero-offset edge of the Nth-weekday math.
    expect(windowForMonth(schedule, 2027, 3).opensAt).toBe(utc("2027-03-01T00:00:00Z"));
  });

  it("reads day boundaries on the realm clock, not UTC", () => {
    const ahead: FaireSchedule = { ...schedule, utcOffsetMinutes: 120 };
    // Realm midnight at UTC+2 is 22:00 UTC the evening before.
    expect(windowForMonth(ahead, 2026, 9).opensAt).toBe(utc("2026-09-06T22:00:00Z"));
  });

  it("honours a non-vanilla rule without code changes", () => {
    const custom: FaireSchedule = { ...schedule, opensOnWeekday: 5, occurrence: 2, durationDays: 3 };
    // Second Friday of Sep 2026 is the 11th.
    const window = windowForMonth(custom, 2026, 9);
    expect(window.opensAt).toBe(utc("2026-09-11T00:00:00Z"));
    expect(window.closesAt).toBe(utc("2026-09-14T00:00:00Z"));
  });
});

describe("locationForMonth", () => {
  it("returns the anchor's location for the anchor month", () => {
    expect(locationForMonth(schedule, 2026, 9)).toBe("elwynn");
  });

  it("alternates every month after the anchor, across a year boundary", () => {
    expect(locationForMonth(schedule, 2026, 10)).toBe("mulgore");
    expect(locationForMonth(schedule, 2026, 11)).toBe("elwynn");
    expect(locationForMonth(schedule, 2026, 12)).toBe("mulgore");
    expect(locationForMonth(schedule, 2027, 1)).toBe("elwynn");
  });

  it("alternates backwards from the anchor too", () => {
    expect(locationForMonth(schedule, 2026, 8)).toBe("mulgore");
    // Nine months back from the anchor is an odd distance, ten is even.
    expect(locationForMonth(schedule, 2025, 12)).toBe("mulgore");
    expect(locationForMonth(schedule, 2025, 11)).toBe("elwynn");
  });

  it("follows the anchor when it is flipped", () => {
    const flipped: FaireSchedule = { ...schedule, anchor: { ...schedule.anchor, location: "mulgore" } };
    expect(locationForMonth(flipped, 2026, 9)).toBe("mulgore");
    expect(locationForMonth(flipped, 2026, 10)).toBe("elwynn");
  });
});

describe("otherLocation", () => {
  it("is its own inverse", () => {
    expect(otherLocation("elwynn")).toBe("mulgore");
    expect(otherLocation(otherLocation("elwynn"))).toBe("elwynn");
  });
});

describe("faireStateAt", () => {
  it("is travelling before the month's opening, pointing at this month's faire", () => {
    const state = faireStateAt(schedule, utc("2026-09-01T12:00:00Z"));
    expect(state.phase).toBe("travelling");
    expect(state.next.opensAt).toBe(utc("2026-09-07T00:00:00Z"));
    expect(state.next.location).toBe("elwynn");
  });

  it("is up from the opening instant", () => {
    const state = faireStateAt(schedule, utc("2026-09-07T00:00:00Z"));
    expect(state.phase).toBe("up");
  });

  it("is up mid-week and points at next month as the one after", () => {
    const state = faireStateAt(schedule, utc("2026-09-10T09:00:00Z"));
    if (state.phase !== "up") throw new Error("expected the faire to be up");
    expect(state.current.location).toBe("elwynn");
    expect(state.next.location).toBe("mulgore");
    expect(state.next.opensAt).toBe(utc("2026-10-05T00:00:00Z"));
  });

  it("closes exclusively — the closing instant is already travelling", () => {
    const state = faireStateAt(schedule, utc("2026-09-14T00:00:00Z"));
    expect(state.phase).toBe("travelling");
    expect(state.next.opensAt).toBe(utc("2026-10-05T00:00:00Z"));
  });

  it("rolls into next month's faire once this month's has ended", () => {
    const state = faireStateAt(schedule, utc("2026-09-30T23:00:00Z"));
    expect(state.phase).toBe("travelling");
    expect(state.next.location).toBe("mulgore");
    expect(state.next.opensAt).toBe(utc("2026-10-05T00:00:00Z"));
  });

  it("crosses the year boundary", () => {
    const state = faireStateAt(schedule, utc("2026-12-28T00:00:00Z"));
    expect(state.phase).toBe("travelling");
    expect(state.next.opensAt).toBe(utc("2027-01-04T00:00:00Z"));
    expect(state.next.location).toBe("elwynn");
  });
});

describe("referenceWindow", () => {
  it("is the live faire while one is up", () => {
    const state = faireStateAt(schedule, utc("2026-09-10T09:00:00Z"));
    expect(referenceWindow(state).opensAt).toBe(utc("2026-09-07T00:00:00Z"));
  });

  it("is the coming faire while travelling", () => {
    const state = faireStateAt(schedule, utc("2026-09-20T09:00:00Z"));
    expect(referenceWindow(state).opensAt).toBe(utc("2026-10-05T00:00:00Z"));
  });
});
