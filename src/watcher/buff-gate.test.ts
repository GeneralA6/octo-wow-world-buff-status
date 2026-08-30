import { describe, expect, it } from "vitest";
import type { BuffState } from "./buff-store.js";
import { shouldAlertForRaid } from "./buff-gate.js";

const buff = (appliedSec: number, durationMs = 1000): BuffState => {
  const appliedAt = new Date(appliedSec * 1000);
  const expiresAt = new Date(appliedAt.getTime() + durationMs);
  return { faction: "alliance", appliedAt, expiresAt, active: true };
};

describe("shouldAlertForRaid", () => {
  it("alerts when no buff is on record", () => {
    expect(shouldAlertForRaid(null, 1_000, 500).alert).toBe(true);
  });

  it("alerts when the buff has already expired", () => {
    const b = buff(100); // expires at 100_000 + 1000 = 101_000ms
    expect(shouldAlertForRaid(b, 200_000, 200_000).alert).toBe(true);
  });

  it("treats now exactly at expiry as expired and alerts", () => {
    const b = buff(100); // expiresAt = 101_000ms
    expect(shouldAlertForRaid(b, 101_000, 101_000).alert).toBe(true);
  });

  it("alerts when the buff is active but the raid finishes after it expires", () => {
    const b = buff(100); // expiresAt = 101_000ms, now well before
    const decision = shouldAlertForRaid(b, 150_000, 100_500);
    expect(decision.alert).toBe(true);
  });

  it("alerts when the predicted end lands exactly on expiry", () => {
    const b = buff(100); // expiresAt = 101_000ms
    expect(shouldAlertForRaid(b, 101_000, 100_500).alert).toBe(true);
  });

  it("stays silent when the buff is active and the raid finishes before it expires", () => {
    const b = buff(100); // expiresAt = 101_000ms
    const decision = shouldAlertForRaid(b, 100_800, 100_500); // ends 200ms before expiry
    expect(decision.alert).toBe(false);
    expect(decision.reason).toMatch(/banked/);
  });
});
