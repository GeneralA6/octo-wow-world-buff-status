/**
 * Aggregates the up/down state of the bot's several realm connections (the watcher plus each
 * listener) into ONE realm-outage signal for the COMMUNITY channel — distinct from the
 * per-connection ops alerts `notifyAdmin` already sends.
 *
 * The realm is only "down" when EVERY supervised connection is sustained-down at once: all three
 * characters sit on the same realm behind the same host, so a lone flaky character is not a realm
 * outage, but all of them dropping together is the strongest evidence the bot has that the realm
 * is unreachable. It is "back up" the moment ANY connection re-establishes (the realm is answering
 * again), even if a chronically-dead character stays down — that is a character problem, not a
 * realm one.
 *
 * Fed the already-latched transitions from each connection's `DownTracker` (which returns true only
 * after a SUSTAINED failure, not a blip), so this inherits the "not a transient blip" threshold for
 * free. Pure and clock-injected, so the quorum logic is unit-tested without a network or a clock.
 */
export class ServerMonitor {
  readonly #ids: ReadonlySet<string>;
  readonly #down = new Set<string>();
  #announced = false;
  #downSince: number | null = null;

  /** `ids` is every connection supervised — typically the watcher plus each listener character. */
  constructor(ids: readonly string[]) {
    this.#ids = new Set(ids);
  }

  /**
   * A connection crossed into sustained-down (its `DownTracker.fail()` just returned true). Returns
   * true iff this is the transition that makes the WHOLE realm down and we have not announced it —
   * i.e. announce the outage now. Idempotent per connection: a connection already counted down does
   * not re-trigger.
   */
  connectionDown(id: string, now: number): boolean {
    if (!this.#ids.has(id)) return false;
    this.#down.add(id);
    if (this.#down.size >= this.#ids.size && !this.#announced) {
      this.#announced = true;
      this.#downSince = now;
      return true;
    }
    return false;
  }

  /**
   * A connection came back (its `DownTracker.recover()` just returned true). Returns the outage
   * duration in ms (>= 0) iff this ends an outage we had announced — i.e. announce recovery now —
   * else null. Only the first connection back closes the outage; later ones return null.
   */
  connectionUp(id: string, now: number): number | null {
    if (!this.#ids.has(id)) return null;
    this.#down.delete(id);
    if (!this.#announced) return null;
    this.#announced = false;
    const since = this.#downSince;
    this.#downSince = null;
    return since === null ? 0 : Math.max(0, now - since);
  }

  /** True while an outage has been announced and not yet recovered — for status/tests. */
  get outageActive(): boolean {
    return this.#announced;
  }
}
