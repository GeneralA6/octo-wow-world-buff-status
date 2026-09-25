import { describeError } from "../errors.js";
import type { Logger } from "../logger.js";
import { humanClock } from "../notify/format.js";
import {
  attributeDrops,
  blessingOutlook,
  coverageLookbackMs,
  DEFAULT_ATTRIBUTION_OPTIONS,
  evaluateForecast,
  sawEnough,
  watchedBefore,
  type AttributionOptions,
  type BlessingVerdict,
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
import {
  DEFAULT_SPIRE_RUN_OPTIONS,
  hordeMembers,
  type SpireRun,
  type SpireRunEndReason,
  type SpireRunTracker,
} from "./spire-runs.js";
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
  /** A gap between readings past which the watch was blind — the tracker's own blackout. */
  readonly readingGapMs?: number;
}

/** What the score is worked out from: the finished runs, the blessings, and when the Spire was read. */
interface History {
  readonly runs: FinishedRun[];
  /** Blessings heard before the moment asked about, inside the score window. */
  readonly drops: number[];
  readonly readingTimes: number[];
}

/** How far back the forecast is scored: enough runs to learn from, recent enough to stay current. */
export const SCORE_WINDOW_MS = 14 * 86_400_000;
/** How often the score is logged, so the logs show it moving. */
const SCORE_LOG_MS = 60 * 60_000;
const DEFAULT_FALLBACK_WITHIN_MS = 45 * 60_000;

/** "21:04Z" — a log line's clock. */
const clock = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)}Z`;

/** A verdict in a log line's words. */
function logVerdict(verdict: BlessingVerdict): string {
  switch (verdict.kind) {
    case "blind":
      return `the watch was blind — it saw ${Math.round(verdict.coverage * 100)}% of the Spire before it`;
    case "explained":
      return `${signedClock(verdict.lagMs)} after the run from ${clock(verdict.run.startedAt)} left`;
    case "mid-run":
      return `${humanClock(verdict.dropAt - verdict.startedAt)} into the run still inside since ${clock(verdict.startedAt)}`;
    case "unexplained":
      return "no Spire run explains it";
  }
}

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
  readonly #readingGapMs: number;
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
    this.#readingGapMs = deps.readingGapMs ?? DEFAULT_SPIRE_RUN_OPTIONS.blackoutMs;
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
    const history = await this.#history(now);
    const drops = [...history.drops, now];
    const verdict = this.#judge(history, drops, now);
    // A blessing that dropped mid-run is unexplained until its run leaves and is credited with it.
    const score = evaluateForecast(history.runs, drops, this.#attribution, now, (dropAt) =>
      dropAt === now ? verdict.kind === "blind" : this.#blindAt(history, dropAt),
    );
    this.#logger.info(`warchief forecast: blessing at ${clock(now)} — ${logVerdict(verdict)}. ${formatScore(score)}`);
    await this.#send(formatBlessingVerdict(verdict, blessingOutlook(score, this.#fallbackWithinMs), score));
  }

  /** What the blessing at `now` says: explained by a run, dropped mid-run, or — with no run in sight —
   *  missed, unless the watch was too blind to have seen the run. */
  #judge(history: History, drops: readonly number[], now: number): BlessingVerdict {
    const attribution = attributeDrops(history.runs, drops, this.#attribution).find((a) => a.dropAt === now);
    if (attribution !== undefined && attribution.run !== null) {
      return { kind: "explained", run: attribution.run, lagMs: attribution.lagMs };
    }
    const underWay = this.#runUnderWay(now);
    if (underWay !== null) return { kind: "mid-run", startedAt: underWay.startedAt, dropAt: now };
    const coverage = watchedBefore(history.readingTimes, now, this.#attribution, this.#readingGapMs);
    return sawEnough(coverage) ? { kind: "unexplained" } : { kind: "blind", coverage };
  }

  #blindAt(history: History, dropAt: number): boolean {
    return !sawEnough(watchedBefore(history.readingTimes, dropAt, this.#attribution, this.#readingGapMs));
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
    const history = await this.#history(now);
    return evaluateForecast(history.runs, history.drops, this.#attribution, now, (dropAt) =>
      this.#blindAt(history, dropAt),
    );
  }

  /**
   * The finished runs and the blessings heard before `now`, from where the score window opens: a
   * fortnight back, or where the watch's readings begin if that is later — a blessing from before it
   * was looking is no miss of its. Stale runs are idlers, never a candidate. The reading times reach
   * back far enough to say how much the watch saw before the earliest of those blessings.
   */
  async #history(now: number): Promise<History> {
    const firstReading = await this.#snapshots.firstTakenAt();
    const from = Math.max(now - SCORE_WINDOW_MS, firstReading?.getTime() ?? now);
    const [records, blessings, readings] = await Promise.all([
      this.#runs.endedSince(new Date(from)),
      this.#blessings(),
      this.#snapshots.takenBetween(new Date(from - coverageLookbackMs(this.#attribution)), new Date(now + 1)),
    ]);
    return {
      runs: records.filter((record) => record.reason !== "stale").map(finished),
      drops: blessings.map((date) => date.getTime()).filter((t) => t >= from && t < now),
      readingTimes: readings.map((date) => date.getTime()),
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
