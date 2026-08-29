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

  it("drops pending whispers on stop", () => {
    const sent: string[] = [];
    const queue = new WhisperQueue((t) => sent.push(t), 1000);
    queue.enqueueAll(["A", "B", "C"], "x");
    queue.stop();
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual(["A"]); // A already went; B and C were dropped
    expect(queue.size).toBe(0);
  });
});
