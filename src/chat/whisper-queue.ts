/**
 * Paces outgoing whispers so a raid alert to many subscribers goes out one at a time rather than
 * in a burst the server would treat as spam. The first whisper while idle sends immediately; each
 * subsequent one waits `intervalMs`.
 *
 * Pacing alone is not enough: the server caps how many DISTINCT recipients you may whisper in a
 * short window and silently rejects the overflow ("too many different players too quickly"). So the
 * caller feeds that signal to `notifyThrottled`, and the queue then backs off for a cooldown and
 * RE-QUEUES the whispers it sent in the seconds before the signal — the ones the server most likely
 * dropped — so they are retried rather than lost. A send that throws (recipient offline, transient
 * socket error) is reported and skipped, never stalling the rest of the queue.
 */

import type { Faction } from "../subscribers/store.js";

export type WhisperSend = (target: string, message: string) => void;
export type WhisperError = (error: unknown, target: string, message: string) => void;
/** Optional measurement hook: called with a one-line summary when the server throttles this
 *  character's whispers, and when a broadcast finishes draining — so the live distinct-recipient
 *  cap and effective throughput can be read straight from the deploy logs. */
export type WhisperMetric = (line: string) => void;

interface QueuedWhisper {
  readonly target: string;
  readonly message: string;
  /** Capitals this message is about (a "park now" alert). Lets a buff drop in one of them purge
   *  the now-stale queued park alerts for that side. Undefined for messages nothing supersedes. */
  readonly cities?: readonly Faction[];
  /** How many times a throttle has already re-queued this whisper. Capped at MAX_RETRIES so a
   *  sustained throttle can't re-send the same recipient over and over (duplicate spam). */
  readonly retries?: number;
}

/** How long to pause after the server throttles us, letting its distinct-recipient window reset. */
const THROTTLE_COOLDOWN_MS = 30_000;
/** How far back a throttle signal reaches — sends within this window are assumed dropped and retried. */
const RETRY_WINDOW_MS = 6_000;
/** Re-queue a throttled whisper at most this many times, then give up. Bounds the duplicates a
 *  sustained throttle can produce: a large notification that keeps tripping the server's window
 *  used to re-send its "boundary" recipients 3–5×; capped, it's at most one extra send. */
const MAX_RETRIES = 1;

export class WhisperQueue {
  readonly #queue: QueuedWhisper[] = [];
  /** Recently-sent whispers (within RETRY_WINDOW_MS), kept so a throttle can retry the dropped ones. */
  readonly #recent: { readonly whisper: QueuedWhisper; readonly at: number }[] = [];
  readonly #send: WhisperSend;
  readonly #intervalMs: number;
  readonly #onError?: WhisperError;
  readonly #onMetric?: WhisperMetric;
  #timer: NodeJS.Timeout | null = null;
  /** While in a throttle cooldown, no whisper is sent before this timestamp. */
  #pausedUntil = 0;
  // Measurement of the live server throttle (see WhisperMetric). An "active window" is one
  // continuous drain from idle; counters reset when the queue next goes idle→active.
  #activeSince = 0;
  #sentSinceActive = 0;
  /** Distinct recipients sent since the window opened OR the last throttle — at the FIRST throttle
   *  this is the server's distinct-recipient cap for this character. */
  #sentSinceThrottle = 0;

  constructor(send: WhisperSend, intervalMs = 1200, onError?: WhisperError, onMetric?: WhisperMetric) {
    this.#send = send;
    this.#intervalMs = intervalMs;
    this.#onError = onError;
    this.#onMetric = onMetric;
  }

  get size(): number {
    return this.#queue.length;
  }

  enqueue(target: string, message: string, cities?: readonly Faction[]): void {
    this.#queue.push({ target, message, cities });
    if (!this.#timer) {
      // Idle -> active: a new drain window opens, so reset the throttle measurement.
      this.#activeSince = Date.now();
      this.#sentSinceActive = 0;
      this.#sentSinceThrottle = 0;
      this.#pump();
    }
  }

  /**
   * Drop still-queued messages ABOUT this capital — a fresh buff dropped there, so the pending
   * "park now to catch it" alerts for that side are stale. Returns how many were dropped. Only
   * pending items are affected; anything already sent is gone. Messages with no `cities` (command
   * replies, the drop message itself) are never touched.
   */
  dropForFaction(faction: Faction): number {
    const before = this.#queue.length;
    const kept = this.#queue.filter((w) => !w.cities?.includes(faction));
    this.#queue.length = 0;
    this.#queue.push(...kept);
    return before - this.#queue.length;
  }

  /** Send the same message to many targets, paced. */
  enqueueAll(targets: readonly string[], message: string): void {
    for (const target of targets) this.enqueue(target, message);
  }

  /**
   * The server throttled our whispers. Re-queue the ones sent in the last few seconds (the likely
   * casualties), deduped by target and skipping any already pending, then pause the queue so the
   * server's window can reset before we resume — so throttled alerts are delayed, never dropped.
   */
  notifyThrottled(): void {
    const now = Date.now();
    // Measurement: at the first throttle of a window, #sentSinceThrottle is the server's
    // distinct-recipient cap for this character; the elapsed time is the window it applied over.
    if (this.#onMetric) {
      const elapsedS = ((now - this.#activeSince) / 1000).toFixed(1);
      this.#onMetric(
        `THROTTLED after ${this.#sentSinceThrottle} distinct this window (${this.#sentSinceActive} total in ${elapsedS}s, interval ${this.#intervalMs}ms)`,
      );
    }
    this.#sentSinceThrottle = 0;
    const cutoff = now - RETRY_WINDOW_MS;
    const queuedTargets = new Set(this.#queue.map((w) => w.target.toLowerCase()));
    const seen = new Set<string>();
    const toRetry: QueuedWhisper[] = [];
    for (const { whisper, at } of this.#recent) {
      if (at < cutoff) continue;
      const key = whisper.target.toLowerCase();
      if (seen.has(key) || queuedTargets.has(key)) continue;
      // Already retried its limit — drop rather than re-send it again (that was the duplicate spam).
      if ((whisper.retries ?? 0) >= MAX_RETRIES) continue;
      seen.add(key);
      toRetry.push({ ...whisper, retries: (whisper.retries ?? 0) + 1 });
    }
    this.#recent.length = 0;
    this.#queue.unshift(...toRetry); // retry the dropped ones first, after the cooldown

    this.#pausedUntil = now + THROTTLE_COOLDOWN_MS;
    if (this.#timer) clearTimeout(this.#timer);
    this.#schedule(THROTTLE_COOLDOWN_MS);
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#queue.length = 0;
    this.#recent.length = 0;
    this.#pausedUntil = 0;
  }

  #schedule(delayMs: number): void {
    this.#timer = setTimeout(() => this.#pump(), delayMs);
    this.#timer.unref?.();
  }

  #pump(): void {
    const now = Date.now();
    if (now < this.#pausedUntil) {
      this.#schedule(this.#pausedUntil - now); // still cooling down — wait it out
      return;
    }
    const next = this.#queue.shift();
    if (!next) {
      // Window drained: report the effective throughput (total distinct sent / wall time).
      if (this.#onMetric && this.#sentSinceActive > 0) {
        const elapsedS = ((now - this.#activeSince) / 1000).toFixed(1);
        this.#onMetric(`drained ${this.#sentSinceActive} whispers in ${elapsedS}s`);
      }
      this.#timer = null;
      return;
    }
    try {
      this.#send(next.target, next.message);
      this.#sentSinceActive++;
      this.#sentSinceThrottle++;
      this.#recordSent(next, now);
    } catch (error) {
      this.#onError?.(error, next.target, next.message);
    }
    this.#schedule(this.#intervalMs);
  }

  #recordSent(whisper: QueuedWhisper, now: number): void {
    this.#recent.push({ whisper, at: now });
    const cutoff = now - RETRY_WINDOW_MS;
    while (this.#recent.length > 0 && (this.#recent[0]?.at ?? now) < cutoff) this.#recent.shift();
  }
}
