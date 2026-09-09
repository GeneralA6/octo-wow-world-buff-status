import { describeError } from "../errors.js";
import type { Logger } from "../logger.js";
import { buffCooldownRemainingMs } from "./broadcast-ledger.js";
import type { BuffDrop, BuffStore, Faction } from "./buff-store.js";
import { classifyDropOrigin, type DropOrigin, type LairActivity } from "./drop-origin.js";
import { RecentBuffs } from "./recent-buffs.js";

/**
 * The buff-drop domain in one place: a heard Rallying Cry yell is deduped (two same-city listeners
 * hear it), classified fresh/saved/unknown from the lair census, and persisted; and the per-faction
 * last-drop / cooldown state the alert policy and status query read. See RAID_ARCHITECTURE.md.
 *
 * `record` returns the drop to ANNOUNCE (or null on a duplicate) — sending it (Discord + whisper) is
 * the caller's job, keeping delivery out of the domain. The lair-activity signal is shared with the
 * watcher, which stamps it every /who (`noteLairPoll`); this reads it to tell a fresh kill (a raid was
 * present) from a saved head (empty lair).
 *
 * NOTE: clear-DURATION recording (the self-improving timer) is deliberately NOT here — it is raid-timer
 * data that feeds the about-to-clear prediction, not buff state, so folding it in would spread this
 * module into the clear handler. Only the drop domain lives here.
 */
export interface BuffTrackerDeps {
  readonly store: BuffStore;
  /** A second same-city listener's echo of the same yell within this window is ignored. */
  readonly dedupWindowMs: number;
  /** A raid seen in the lair within this long before a drop makes it a fresh, attributable kill. */
  readonly freshWindowMs: number;
  /** Server Rallying Cry cooldown (0 = none) — for the expectation gate, never for a detected drop. */
  readonly cooldownMs: number;
  /** The lair-poll signal, shared with the watcher (which writes it via noteLairPoll). */
  readonly activity: LairActivity;
  readonly logger: Pick<Logger, "info" | "error">;
}

/** A drop worth announcing: when it landed and whether it was a fresh kill / saved head / unknown. */
export interface RecordedDrop {
  readonly appliedAt: Date;
  readonly origin: DropOrigin;
}

/** Per-faction cooldown readout for the status command (matches the command router's BuffCooldown). */
export interface BuffCooldownState {
  readonly faction: Faction;
  readonly sinceLastDropMs: number | null;
  readonly cooldownRemainingMs: number;
}

export class BuffTracker {
  readonly #store: BuffStore;
  readonly #recent: RecentBuffs;
  readonly #freshWindowMs: number;
  readonly #cooldownMs: number;
  readonly #activity: LairActivity;
  readonly #logger: Pick<Logger, "info" | "error">;

  constructor(deps: BuffTrackerDeps) {
    this.#store = deps.store;
    this.#recent = new RecentBuffs(deps.dedupWindowMs);
    this.#freshWindowMs = deps.freshWindowMs;
    this.#cooldownMs = deps.cooldownMs;
    this.#activity = deps.activity;
    this.#logger = deps.logger;
  }

  /**
   * A listener heard a Rallying Cry yell for `faction` at `now`. Ignores a duplicate a second
   * same-city listener heard moments ago (returns null), else classifies the drop's origin, persists
   * it (best-effort), and returns it for the caller to announce.
   */
  record(faction: Faction, meta: { sourceName: string; text: string; detectedBy: string }, now: number): RecordedDrop | null {
    if (!this.#recent.fresh(faction, now)) {
      this.#logger.info(`buff drop: ${faction} already recorded moments ago — ignoring duplicate heard by ${meta.detectedBy}`);
      return null;
    }
    const appliedAt = new Date(now);
    const origin = classifyDropOrigin(now, this.#activity, { freshWindowMs: this.#freshWindowMs });
    this.#logger.info(`buff drop: ${faction} buff is up (${origin}) — ${meta.detectedBy} heard "${meta.text}" from ${meta.sourceName}`);
    void this.#store.record({ faction, appliedAt }).catch((error) => this.#logger.error(`buff-store: ${describeError(error)}`));
    return { appliedAt, origin };
  }

  /** When this side's Rallying Cry last dropped, or null — the alert policy's cooldown/cycle input. */
  async lastDropAt(faction: Faction): Promise<Date | null> {
    return (await this.#store.current(faction))?.appliedAt ?? null;
  }

  /** The cooldown readout for a side: time since the last drop and the remaining cooldown (0 if off). */
  async cooldownState(faction: Faction, now: number): Promise<BuffCooldownState> {
    const at = (await this.#store.current(faction))?.appliedAt ?? null;
    return {
      faction,
      sinceLastDropMs: at ? now - at.getTime() : null,
      cooldownRemainingMs: buffCooldownRemainingMs(at, now, this.#cooldownMs),
    };
  }

  /** The last `limit` drops for a faction, chronological — for measuring the real drop interval. */
  history(faction: Faction, limit: number): Promise<BuffDrop[]> {
    return this.#store.history(faction, limit);
  }
}
