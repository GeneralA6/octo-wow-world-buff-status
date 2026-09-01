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

interface QueuedWhisper {
  readonly target: string;
  readonly message: string;
  /** Capitals this message is about (a "park now" alert). Lets a buff drop in one of them purge
   *  the now-stale queued park alerts for that side. Undefined for messages nothing supersedes. */
  readonly cities?: readonly Faction[];
}

/** How long to pause after the server throttles us, letting its distinct-recipient window reset. */
const THROTTLE_COOLDOWN_MS = 30_000;
/** How far back a throttle signal reaches — sends within this window are assumed dropped and retried. */
const RETRY_WINDOW_MS = 6_000;

export class WhisperQueue {
  readonly #queue: QueuedWhisper[] = [];
  /** Recently-sent whispers (within RETRY_WINDOW_MS), kept so a throttle can retry the dropped ones. */
  readonly #recent: { readonly whisper: QueuedWhisper; readonly at: number }[] = [];
  readonly #send: WhisperSend;
  readonly #intervalMs: number;
  readonly #onError?: WhisperError;
  #timer: NodeJS.Timeout | null = null;
  /** While in a throttle cooldown, no whisper is sent before this timestamp. */
  #pausedUntil = 0;

  constructor(send: WhisperSend, intervalMs = 1200, onError?: WhisperError) {
    this.#send = send;
    this.#intervalMs = intervalMs;
    this.#onError = onError;
  }

  get size(): number {
    return this.#queue.length;
  }

  enqueue(target: string, message: string, cities?: readonly Faction[]): void {
    this.#queue.push({ target, message, cities });
    if (!this.#timer) this.#pump();
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
    const cutoff = now - RETRY_WINDOW_MS;
    const queuedTargets = new Set(this.#queue.map((w) => w.target.toLowerCase()));
    const seen = new Set<string>();
    const retries: QueuedWhisper[] = [];
    for (const { whisper, at } of this.#recent) {
      if (at < cutoff) continue;
      const key = whisper.target.toLowerCase();
      if (seen.has(key) || queuedTargets.has(key)) continue;
      seen.add(key);
      retries.push(whisper);
    }
    this.#recent.length = 0;
    this.#queue.unshift(...retries); // retry the dropped ones first, after the cooldown

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
      this.#timer = null;
      return;
    }
    try {
      this.#send(next.target, next.message);
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
