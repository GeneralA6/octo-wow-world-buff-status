import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhisperQueue } from "./whisper-queue.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("WhisperQueue", () => {
  it("sends the first whisper immediately and paces the rest", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t, m) => sent.push(`${t}:${m}`), 1000);

    queue.enqueue("A", "1");
    expect(sent).toEqual(["A:1"]); // immediate while idle

    queue.enqueue("B", "2");
    queue.enqueue("C", "3");
    expect(sent).toHaveLength(1); // throttled

    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["A:1", "B:2"]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["A:1", "B:2", "C:3"]);
  });

  it("fans one message out to many targets, paced", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t) => sent.push(t), 500);
    queue.enqueueAll(["A", "B", "C"], "raid up");
    expect(sent).toEqual(["A"]);
    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual(["A", "B", "C"]);
  });

  it("keeps going when a send throws, reporting the failure", () => {
    const sent: string[] = [];
    const errors: string[] = [];
    const queue = new WhisperQueue(
      (t) => {
        if (t === "B") throw new Error("offline");
        sent.push(t);
      },
      1000,
      (_e, t) => errors.push(t),
    );
    queue.enqueueAll(["A", "B", "C"], "x");
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["A", "C"]);
    expect(errors).toEqual(["B"]);
  });

  it("reports the distinct-recipient count to the metric hook on throttle", () => {
    const metrics: string[] = [];
    const queue = new WhisperQueue(() => {}, 1000, undefined, (line) => metrics.push(line));
    queue.enqueueAll(["A", "B", "C", "D"], "x"); // A sent immediately
    vi.advanceTimersByTime(1000); // B
    vi.advanceTimersByTime(1000); // C  -> 3 sent, D pending
    queue.notifyThrottled();
    expect(metrics.some((m) => m.includes("THROTTLED after 3 distinct"))).toBe(true);
  });

  it("reports the drained count and time to the metric hook", () => {
    const metrics: string[] = [];
    const queue = new WhisperQueue(() => {}, 1000, undefined, (line) => metrics.push(line));
    queue.enqueueAll(["A", "B"], "x"); // A immediate, B pending
    vi.advanceTimersByTime(1000); // B sent
    vi.advanceTimersByTime(1000); // queue empties -> drain reported
    expect(metrics.some((m) => /drained 2 whispers in [\d.]+s/.test(m))).toBe(true);
  });

  it("drops pending whispers on stop", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t) => sent.push(t), 1000);
    queue.enqueueAll(["A", "B", "C"], "x");
    queue.stop();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(["A"]); // A already went; B and C were dropped
    expect(queue.size).toBe(0);
  });

  it("dropForFaction purges only the pending park alerts about that capital", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t) => sent.push(t), 1000);
    queue.enqueue("A", "park SW", ["alliance"]); // sent immediately (idle)
    queue.enqueue("B", "park SW", ["alliance"]); // queued
    queue.enqueue("C", "park OG", ["horde"]); // queued, other side
    queue.enqueue("D", "your status: ..."); // queued, untagged (a command reply)
    expect(sent).toEqual(["A"]);

    const dropped = queue.dropForFaction("alliance"); // alliance buff dropped → its park alerts stale
    expect(dropped).toBe(1); // only B (still queued, alliance)
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(["A", "C", "D"]); // B gone; the horde park and the reply still delivered
  });

  it("retries a throttled whisper after a cooldown instead of dropping it", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t) => sent.push(t), 1000);
    queue.enqueue("A", "park now");
    expect(sent).toEqual(["A"]); // sent immediately, then the server drops it
    queue.notifyThrottled();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["A"]); // paused during the cooldown — no resend yet
    vi.advanceTimersByTime(30_000); // cooldown elapses
    expect(sent).toEqual(["A", "A"]); // retried, not lost
  });

  it("sends nothing during the throttle cooldown, then resumes", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t) => sent.push(t), 1000);
    queue.enqueueAll(["A", "B", "C"], "x"); // A sent, B/C queued
    expect(sent).toEqual(["A"]);
    queue.notifyThrottled();
    vi.advanceTimersByTime(29_000); // still within the cooldown
    expect(sent).toEqual(["A"]); // fully paused
    vi.advanceTimersByTime(5_000); // past the cooldown
    expect(sent.length).toBeGreaterThan(1); // resumed delivering
  });

  it("caps retries: a repeatedly-throttled whisper is re-sent at most once, never looped", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t) => sent.push(t), 1000);
    queue.enqueue("A", "park now");
    expect(sent).toEqual(["A"]); // 1st send (idle)
    queue.notifyThrottled(); // server dropped it → re-queue once
    vi.advanceTimersByTime(31_000);
    expect(sent).toEqual(["A", "A"]); // retried once
    queue.notifyThrottled(); // throttled AGAIN → already at the cap → dropped, not re-queued
    vi.advanceTimersByTime(31_000);
    expect(sent).toEqual(["A", "A"]); // NOT sent a third time — the loop is broken
    expect(queue.size).toBe(0); // queue drained, no livelock
  });

  it("doesn't duplicate a retry for a target still pending in the queue", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t) => sent.push(t), 1000);
    queue.enqueueAll(["A", "B"], "x"); // A sent, B still queued
    expect(sent).toEqual(["A"]);
    queue.notifyThrottled(); // A is recent (re-queued); B is already queued (not re-added)
    vi.advanceTimersByTime(31_000); // resume after cooldown
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual(["A", "A", "B"]); // A retried once, B delivered once — not doubled
  });
});
