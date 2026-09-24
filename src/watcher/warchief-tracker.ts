import { describeError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { BuffStore } from "./buff-store.js";
import { RecentBuffs } from "./recent-buffs.js";

/**
 * The Warchief's Blessing drops: Thrall's yell in Orgrimmar, heard by the listeners parked there.
 *
 * Simpler than the Rallying Cry's BuffTracker on purpose — there is no lair to watch for Rend, so no
 * fresh-or-saved origin and no cooldown gate. A drop is deduped (both Orgrimmar listeners, and both of
 * Thrall's yells, land within moments), persisted, and handed back for the caller to announce; the
 * last one answers a Horde player's status.
 */

export interface WarchiefTrackerDeps {
  readonly store: BuffStore;
  /** A second yell, or a second listener's echo, within this window is the same drop. */
  readonly dedupWindowMs: number;
  readonly logger: Pick<Logger, "info" | "error">;
}

export class WarchiefBlessingTracker {
  readonly #store: BuffStore;
  readonly #recent: RecentBuffs;
  readonly #logger: Pick<Logger, "info" | "error">;

  constructor(deps: WarchiefTrackerDeps) {
    this.#store = deps.store;
    this.#recent = new RecentBuffs(deps.dedupWindowMs);
    this.#logger = deps.logger;
  }

  /** A listener heard Thrall's yell at `now`. The drop to announce, or null for a duplicate. */
  record(meta: { sourceName: string; text: string; detectedBy: string }, now: number): Date | null {
    if (!this.#recent.fresh("horde", now)) {
      this.#logger.info(`warchief's blessing: already recorded moments ago — ignoring the echo heard by ${meta.detectedBy}`);
      return null;
    }
    const appliedAt = new Date(now);
    this.#logger.info(`warchief's blessing: up in Orgrimmar — ${meta.detectedBy} heard "${meta.text}" from ${meta.sourceName}`);
    void this.#store
      .record({ faction: "horde", appliedAt })
      .catch((error) => this.#logger.error(`warchief store: ${describeError(error)}`));
    return appliedAt;
  }

  /** How long ago the blessing last dropped, or null when none has been seen. */
  async lastDropAgo(now: number): Promise<number | null> {
    const last = await this.#store.current("horde");
    return last ? now - last.appliedAt.getTime() : null;
  }
}
