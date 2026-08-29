/**
 * Paces outgoing whispers so a raid alert to many subscribers goes out one at a
 * time rather than in a burst the server would treat as spam (and mute). The first
 * whisper while idle sends immediately; each subsequent one waits `intervalMs`.
 *
 * A send that throws (recipient offline, transient socket error) is reported and
 * skipped, never stalling the rest of the queue.
 */

export type WhisperSend = (target: string, message: string) => void;
export type WhisperError = (error: unknown, target: string, message: string) => void;

interface QueuedWhisper {
  readonly target: string;
  readonly message: string;
}

export class WhisperQueue {
  readonly #queue: QueuedWhisper[] = [];
  readonly #send: WhisperSend;
  readonly #intervalMs: number;
  readonly #onError?: WhisperError;
  #timer: NodeJS.Timeout | null = null;

  constructor(send: WhisperSend, intervalMs = 1200, onError?: WhisperError) {
    this.#send = send;
    this.#intervalMs = intervalMs;
    this.#onError = onError;
  }

  get size(): number {
    return this.#queue.length;
  }

  enqueue(target: string, message: string): void {
    this.#queue.push({ target, message });
    if (!this.#timer) this.#pump();
  }

  /** Send the same message to many targets, paced. */
  enqueueAll(targets: readonly string[], message: string): void {
    for (const target of targets) this.enqueue(target, message);
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#queue.length = 0;
  }

  #pump(): void {
    const next = this.#queue.shift();
    if (!next) {
      this.#timer = null;
      return;
    }
    try {
      this.#send(next.target, next.message);
    } catch (error) {
      this.#onError?.(error, next.target, next.message);
    }
    this.#timer = setTimeout(() => this.#pump(), this.#intervalMs);
    this.#timer.unref?.();
  }
}
