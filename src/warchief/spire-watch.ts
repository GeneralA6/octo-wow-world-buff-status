import { describeError } from "../errors.js";
import type { Logger } from "../logger.js";
import { humanClock } from "../notify/format.js";
import {
  attributeDrops,
  blessingOutlook,
  DEFAULT_ATTRIBUTION_OPTIONS,
  evaluateForecast,
  type AttributionOptions,
  type FinishedRun,
  type ForecastEvaluation,
} from "./forecast.js";
import {
  formatBlessingVerdict,
  formatRunEnded,
  formatRunStarted,
  formatScore,
  signedClock,
  type ShadowNotice,
} from "./format.js";
import type { SpireRunRecord, SpireRunStore } from "./run-store.js";
import { hordeMembers, type SpireRun, type SpireRunEndReason, type SpireRunTracker } from "./spire-runs.js";
import type { SpireSnapshotStore } from "./spire-snapshot-store.js";
import type { SpireView } from "./spire-view.js";

/**
 * The Warchief's Blessing SHADOW forecast, live: every Blackrock Spire reading is kept and fed to the
 * run tracker; a UBRS run coming in, and leaving with the time its blessing should land by, is posted
 * to the tests channel; and each blessing heard in Orgrimmar is held up against the forecast, with
 * the score so far. Nothing here reaches players — it runs beside the real alerts until the replays
 * say it is good enough to.
 *
 * Only runs with a Horde member are posted (no one else can turn the head in to Thrall); every run is
 * logged and kept either way, so replays can question that gate. A store or channel that fails is
 * logged and skipped — the tracker must see every reading, whatever else goes wrong.
 */

export interface SpireWatchDeps {
  readonly tracker: SpireRunTracker;
  readonly snapshots: SpireSnapshotStore;
  readonly runs: SpireRunStore;
  /** The Warchief's Blessings heard — at least the last fortnight's — in any order. */
  readonly blessings: () => Promise<readonly Date[]>;
  /** Where the shadow notices go: the tests channel, never players. */
  readonly notify: (notice: ShadowNotice) => Promise<void>;
  readonly logger: Pick<Logger, "info" | "debug" | "error">;
  readonly attribution?: AttributionOptions;
  /** The window quoted after a run leaves, until enough blessings are explained to learn one. */
  readonly fallbackWithinMs?: number;
}

/** How far back the forecast is scored: enough runs to learn from, recent enough to stay current. */
export const SCORE_WINDOW_MS = 14 * 86_400_000;
/** How often the score is logged, so the logs show it moving. */
const SCORE_LOG_MS = 60 * 60_000;
const DEFAULT_FALLBACK_WITHIN_MS = 45 * 60_000;

/** "21:04Z" — a log line's clock. */
const clock = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)}Z`;

function finished(record: SpireRunRecord): FinishedRun {
  return {
    startedAt: record.startedAt.getTime(),
    endedAt: record.endedAt.getTime(),
    horde: record.horde,
    reason: record.reason,
    baseline: record.baseline,
  };
}

export class SpireWatch {
  readonly #tracker: SpireRunTracker;
  readonly #snapshots: SpireSnapshotStore;
  readonly #runs: SpireRunStore;
  readonly #blessings: () => Promise<readonly Date[]>;
  readonly #notify: (notice: ShadowNotice) => Promise<void>;
  readonly #logger: Pick<Logger, "info" | "debug" | "error">;
  readonly #attribution: AttributionOptions;
  readonly #fallbackWithinMs: number;
  #lastScoreLogAt: number | null = null;

  constructor(deps: SpireWatchDeps) {
    this.#tracker = deps.tracker;
    this.#snapshots = deps.snapshots;
    this.#runs = deps.runs;
    this.#blessings = deps.blessings;
    this.#notify = deps.notify;
    this.#logger = deps.logger;
    this.#attribution = deps.attribution ?? DEFAULT_ATTRIBUTION_OPTIONS;
    this.#fallbackWithinMs = deps.fallbackWithinMs ?? DEFAULT_FALLBACK_WITHIN_MS;
  }

  /** One Spire reading from the poll. */
  async observe(view: SpireView): Promise<void> {
    void this.#snapshots
      .record({ ts: new Date(view.at), complete: view.complete, players: view.present })
      .catch((error) => this.#logger.debug(`spire snapshot: ${describeError(error)}`));
    for (const event of this.#tracker.observe(view)) {
      if (event.kind === "run-started") await this.#runStarted(event.run);
      else await this.#runEnded(event.run, event.endedAt, event.reason, view.at);
    }
    if (this.#lastScoreLogAt === null || view.at - this.#lastScoreLogAt >= SCORE_LOG_MS) {
      this.#lastScoreLogAt = view.at;
      await this.#score(view.at)
        .then((score) => this.#logger.info(`warchief forecast: ${formatScore(score)}`))
        .catch((error) => this.#logger.error(`warchief forecast score: ${describeError(error)}`));
    }
  }

  /** Thrall's yell was heard: the blessing dropped at `at`. Held up against the forecast. */
  async onBlessing(at: Date): Promise<void> {
    const now = at.getTime();
    const { runs, drops } = await this.#history(now);
    const all = [...drops, now];
    const attribution = attributeDrops(runs, all, this.#attribution).find((a) => a.dropAt === now);
    if (!attribution) return;
    const midRun = attribution.run === null ? this.#runUnderWay(now) : null;
    const score = evaluateForecast(runs, all, this.#attribution, now);
    const notice = formatBlessingVerdict(attribution, midRun, blessingOutlook(score, this.#fallbackWithinMs), score);
    const verdict =
      attribution.run !== null
        ? `${signedClock(attribution.lagMs)} after the run from ${clock(attribution.run.startedAt)} left`
        : midRun !== null
          ? `${humanClock(now - midRun.startedAt)} into run #${midRun.id}, still inside`
          : "no Spire run explains it";
    this.#logger.info(`warchief forecast: blessing at ${clock(now)} — ${verdict}. ${formatScore(score)}`);
    await this.#send(notice);
  }

  async #runStarted(run: SpireRun): Promise<void> {
    const horde = hordeMembers(run.roster);
    this.#logger.info(
      `spire: run #${run.id} in — ${run.roster.length} players (${horde} Horde) from ${clock(run.startedAt)}` +
        (run.baseline ? ", already inside on first look" : ""),
    );
    if (horde > 0) await this.#send(formatRunStarted(run, horde));
  }

  async #runEnded(run: SpireRun, endedAt: number, reason: SpireRunEndReason, now: number): Promise<void> {
    const horde = hordeMembers(run.roster);
    await this.#runs
      .record({
        startedAt: new Date(run.startedAt),
        formedAt: new Date(run.formedAt),
        endedAt: new Date(endedAt),
        reason,
        baseline: run.baseline,
        peak: run.peak,
        horde,
        roster: run.roster,
      })
      .catch((error) => this.#logger.error(`spire run store: ${describeError(error)}`));
    const outlook = await this.#score(now)
      .then((score) => blessingOutlook(score, this.#fallbackWithinMs))
      .catch((error) => {
        this.#logger.error(`warchief forecast score: ${describeError(error)}`);
        return { withinMs: this.#fallbackWithinMs, learned: false };
      });
    this.#logger.info(
      `spire: run #${run.id} ${reason} after ${humanClock(endedAt - run.startedAt)} ` +
        `(peak ${run.peak}, ${horde} Horde)` +
        (horde > 0 && reason !== "stale" ? ` — blessing expected by ${clock(endedAt + outlook.withinMs)}` : ""),
    );
    if (horde > 0) await this.#send(formatRunEnded(run, endedAt, reason, horde, outlook));
  }

  /** The score over the window up to `now`. */
  async #score(now: number): Promise<ForecastEvaluation> {
    const { runs, drops } = await this.#history(now);
    return evaluateForecast(runs, drops, this.#attribution, now);
  }

  /**
   * The finished runs and the blessings heard before `now`, from where the score window opens: a
   * fortnight back, or where the watch's readings begin if that is later — a blessing from before it
   * was looking is no miss of its. Stale runs are idlers, never a candidate.
   */
  async #history(now: number): Promise<{ runs: FinishedRun[]; drops: number[] }> {
    const coverage = await this.#snapshots.firstTakenAt();
    const from = Math.max(now - SCORE_WINDOW_MS, coverage?.getTime() ?? now);
    const [records, blessings] = await Promise.all([this.#runs.endedSince(new Date(from)), this.#blessings()]);
    return {
      runs: records.filter((record) => record.reason !== "stale").map(finished),
      drops: blessings.map((date) => date.getTime()).filter((t) => t >= from && t < now),
    };
  }

  /** The Horde run under way long enough to have killed Rend — the earliest in, if more than one. */
  #runUnderWay(now: number): SpireRun | null {
    const candidates = this.#tracker
      .activeRuns()
      .filter((run) => hordeMembers(run.roster) > 0 && now - run.startedAt >= this.#attribution.minRendMs)
      .sort((a, b) => a.startedAt - b.startedAt);
    return candidates[0] ?? null;
  }

  async #send(notice: ShadowNotice): Promise<void> {
    await this.#notify(notice).catch((error) => this.#logger.error(`warchief forecast notify: ${describeError(error)}`));
  }
}
