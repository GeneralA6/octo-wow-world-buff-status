import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPIRE_RUN_OPTIONS,
  hordeMembers,
  SpireRunTracker,
  type SpireRunEvent,
} from "./spire-runs.js";
import type { SpirePlayer, SpireView } from "./spire-view.js";

const MIN = 60_000;
const ORC = 2;
const HUMAN = 1;

const player = (name: string, raceId = ORC): SpirePlayer => ({ name, guild: "", level: 60, classId: 1, raceId });

/** Who is inside, and between which minutes [in, out). */
interface Stay {
  readonly player: SpirePlayer;
  readonly from: number;
  readonly to: number;
}

const stay = (name: string, from: number, to: number, raceId = ORC): Stay => ({ player: player(name, raceId), from, to });

/** A raid of `size` walking in one a minute from `from`, all leaving at `to`. */
const raid = (prefix: string, size: number, from: number, to: number): Stay[] =>
  Array.from({ length: size }, (_, i) => stay(`${prefix}${i}`, from + i, to));

/** One reading a minute over [start, end], as the poll would take them. */
function readings(stays: readonly Stay[], start: number, end: number, complete = true): SpireView[] {
  const views: SpireView[] = [];
  for (let minute = start; minute <= end; minute += 1) {
    const present = stays.filter((s) => s.from <= minute && minute < s.to).map((s) => s.player);
    views.push({ present, complete, at: minute * MIN });
  }
  return views;
}

function replay(views: readonly SpireView[], tracker = new SpireRunTracker()): SpireRunEvent[] {
  return views.flatMap((view) => tracker.observe(view));
}

const started = (events: readonly SpireRunEvent[]) => events.filter((e) => e.kind === "run-started");
const ended = (events: readonly SpireRunEvent[]) =>
  events.flatMap((e) => (e.kind === "run-ended" ? [e] : []));

describe("SpireRunTracker", () => {
  it("recognises a raid walking in together, on the reading its eighth member arrives", () => {
    // An empty first look, then ten players one a minute from minute 2.
    const events = replay(readings(raid("r", 10, 2, 60), 0, 20));
    const [start] = started(events);
    expect(start?.run.startedAt).toBe(2 * MIN);
    expect(start?.run.formedAt).toBe(9 * MIN); // r7 is the eighth
    expect(start?.run.baseline).toBe(false);
    expect(started(events)).toHaveLength(1);
  });

  it("fills the run with the members who come in after it is recognised", () => {
    const tracker = new SpireRunTracker();
    replay(readings(raid("r", 10, 2, 60), 0, 20), tracker);
    expect(tracker.activeRuns()[0]?.roster.map((p) => p.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `r${i}`),
    );
  });

  it("never takes a five-man party for a raid", () => {
    expect(started(replay(readings(raid("p", 5, 1, 90), 0, 90)))).toEqual([]);
  });

  it("does not chain two parties that came in half an hour apart", () => {
    const stays = [...raid("a", 5, 1, 120), ...raid("b", 5, 35, 120)];
    expect(started(replay(readings(stays, 0, 120)))).toEqual([]);
  });

  it("does not absorb a party that came in long after the run", () => {
    const tracker = new SpireRunTracker();
    replay(readings([...raid("r", 10, 2, 90), ...raid("p", 5, 40, 90)], 0, 60), tracker);
    expect(tracker.activeRuns()[0]?.roster).toHaveLength(10);
  });

  it("ends the run once its roster has stayed out past the sustain, dated when it left", () => {
    const events = replay(readings(raid("r", 10, 2, 45), 0, 60));
    const [end] = ended(events);
    expect(end?.reason).toBe("left");
    expect(end?.endedAt).toBe(45 * MIN);
    expect(end?.run.peak).toBe(10);
  });

  it("holds the run through a wipe's run back", () => {
    // Everyone out for four minutes (released, running back), then in again until minute 70.
    const members = raid("r", 10, 2, 30);
    const back = members.map((s) => ({ ...s, from: 34, to: 70 }));
    const events = replay(readings([...members, ...back], 0, 80));
    expect(started(events)).toHaveLength(1);
    expect(ended(events).map((e) => e.endedAt)).toEqual([70 * MIN]);
  });

  it("puts members back on their run when they return after being forgotten", () => {
    // Four minutes out is past the three-minute grace, so they come back as new arrivals — all ten
    // at once, which would make a run of their own if they were not recognised as this one's.
    const tracker = new SpireRunTracker();
    const members = raid("r", 10, 2, 30);
    const back = members.map((s) => ({ ...s, from: 34, to: 70 }));
    const events = replay(readings([...members, ...back], 0, 40), tracker);
    expect(started(events)).toHaveLength(1);
    expect(tracker.activeRuns()[0]?.roster).toHaveLength(10);
  });

  it("says when a run's roster started walking out, before the leaving is confirmed", () => {
    const tracker = new SpireRunTracker();
    replay(readings(raid("r", 10, 2, 45), 0, 44), tracker);
    expect(tracker.activeRuns()[0]?.leavingSince).toBeNull();
    replay(readings(raid("r", 10, 2, 45), 45, 47), tracker);
    expect(tracker.activeRuns()[0]?.leavingSince).toBe(45 * MIN);
  });

  it("never starts a departure on a truncated reading", () => {
    const tracker = new SpireRunTracker();
    replay(readings(raid("r", 10, 2, 60), 0, 30), tracker);
    const truncated = replay(readings([], 31, 45, false), tracker);
    expect(ended(truncated)).toEqual([]);
  });

  it("marks a run found already inside on the first look as a baseline", () => {
    const events = replay(readings(raid("r", 10, -20, 60).map((s) => ({ ...s, from: -20 })), 0, 5));
    expect(started(events)[0]?.run.baseline).toBe(true);
    expect(started(events)[0]?.run.formedAt).toBe(0);
  });

  it("ends a run that vanished across a blind gap as blind, dated when last seen at strength", () => {
    const tracker = new SpireRunTracker();
    replay(readings(raid("r", 10, 2, 60), 0, 20), tracker);
    // Nothing read from minute 21 to 40; by then the raid is gone.
    const events = replay(readings([], 41, 42), tracker);
    const [end] = ended(events);
    expect(end?.reason).toBe("blind");
    expect(end?.endedAt).toBe(20 * MIN);
  });

  it("carries a run on across a blind gap when it is still inside", () => {
    const tracker = new SpireRunTracker();
    const stays = raid("r", 10, 2, 90);
    replay(readings(stays, 0, 20), tracker);
    expect(ended(replay(readings(stays, 41, 50), tracker))).toEqual([]);
    expect(tracker.activeRuns()).toHaveLength(1);
  });

  it("ends a run that never leaves as stale", () => {
    const options = { ...DEFAULT_SPIRE_RUN_OPTIONS, maxRunMs: 60 * MIN };
    const events = replay(readings(raid("r", 10, 2, 500), 0, 70), new SpireRunTracker(options));
    const [end] = ended(events);
    expect(end?.reason).toBe("stale");
    expect(end?.endedAt).toBe(63 * MIN);
  });

  it("does not let a run's stragglers seed a new one", () => {
    // A run that gives up at 14 leaves its last three arrivals (in at 9-11) inside, and a party of
    // five walks in at 15-19: close enough in time to chain with the stragglers into eight.
    const members = raid("r", 10, 2, 14).map((s, i) => (i >= 7 ? { ...s, to: 120 } : s));
    const events = replay(readings([...members, ...raid("p", 5, 15, 120)], 0, 60));
    expect(ended(events)).toHaveLength(1);
    expect(started(events)).toHaveLength(1);
  });
});

describe("hordeMembers", () => {
  it("counts the players who could turn the head in to Thrall", () => {
    expect(hordeMembers([player("a", ORC), player("b", HUMAN), player("c", 5)])).toBe(2);
  });
});
