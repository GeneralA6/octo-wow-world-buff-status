import { parseArgs } from "node:util";
import { humanClock } from "../notify/format.js";
import { DEFAULT_ATTRIBUTION_OPTIONS, type AttributionOptions, type ForecastEvaluation } from "./forecast.js";
import { formatScore, signedClock } from "./format.js";
import { occupancyBefore, replaySpire, type ReplayResult } from "./replay.js";
import { DEFAULT_SPIRE_RUN_OPTIONS, type SpireRunOptions } from "./spire-runs.js";
import type { SpireSnapshot } from "./spire-snapshot-store.js";

/**
 * The replay CLI's pure half: its arguments, and the report it prints. See replay-cli.ts for the
 * half that touches MongoDB.
 */

export interface ReplayArgs {
  /** How many days of readings, back from now. */
  readonly days: number;
  readonly tracker: SpireRunOptions;
  readonly attribution: AttributionOptions;
  /** Also try a grid of thresholds and rank them. */
  readonly sweep: boolean;
  /** Also list every run found and what each blessing was put down to. */
  readonly runs: boolean;
  /** Also show the Spire headcount in the hours before each blessing. */
  readonly context: boolean;
}

const MIN = 60_000;

function positive(name: string, raw: string | undefined, fallback: number, integer = true): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`--${name} must be a positive ${integer ? "whole number" : "number"}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Read the CLI's arguments; minutes where the option is a time. Throws on a malformed value. */
export function parseReplayArgs(argv: readonly string[]): ReplayArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      days: { type: "string" },
      "min-run-size": { type: "string" },
      "link-gap": { type: "string" },
      "join-gap": { type: "string" },
      "max-run-size": { type: "string" },
      "left-fraction": { type: "string" },
      "end-sustained": { type: "string" },
      "min-rend": { type: "string" },
      window: { type: "string" },
      "any-faction": { type: "boolean", default: false },
      sweep: { type: "boolean", default: false },
      runs: { type: "boolean", default: false },
      context: { type: "boolean", default: false },
    },
    strict: true,
  });
  const leftFraction = positive("left-fraction", values["left-fraction"], DEFAULT_SPIRE_RUN_OPTIONS.leftFraction, false);
  if (leftFraction >= 1) throw new Error(`--left-fraction must be below 1, got ${leftFraction}`);
  const d = DEFAULT_SPIRE_RUN_OPTIONS;
  const a = DEFAULT_ATTRIBUTION_OPTIONS;
  return {
    days: positive("days", values.days, 14),
    tracker: {
      ...d,
      minRunSize: positive("min-run-size", values["min-run-size"], d.minRunSize),
      linkGapMs: positive("link-gap", values["link-gap"], d.linkGapMs / MIN) * MIN,
      joinGapMs: positive("join-gap", values["join-gap"], d.joinGapMs / MIN) * MIN,
      maxRunSize: positive("max-run-size", values["max-run-size"], d.maxRunSize),
      leftFraction,
      endSustainedMs: positive("end-sustained", values["end-sustained"], d.endSustainedMs / MIN) * MIN,
    },
    attribution: {
      minRendMs: positive("min-rend", values["min-rend"], a.minRendMs / MIN) * MIN,
      windowMs: positive("window", values.window, a.windowMs / MIN) * MIN,
      requireHorde: !values["any-faction"],
    },
    sweep: values.sweep,
    runs: values.runs,
    context: values.context,
  };
}

/** "2026-09-25 21:04Z". */
const stamp = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")}Z`;
/** "21:04Z". */
const clock = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)}Z`;

export function describeOptions(tracker: SpireRunOptions, attribution: AttributionOptions): string {
  return (
    `runs: ${tracker.minRunSize}+ in within ${humanClock(tracker.linkGapMs)} of each other, ` +
    `late joiners within ${humanClock(tracker.joinGapMs)}, cap ${tracker.maxRunSize}, ` +
    `gone when under ${Math.round(tracker.leftFraction * 100)}% for ${humanClock(tracker.endSustainedMs)} | ` +
    `blessings: from ${humanClock(attribution.minRendMs)} into a run to ${humanClock(attribution.windowMs)} after it left, ` +
    (attribution.requireHorde ? "Horde runs only" : "any run")
  );
}

/** Harmonic mean of the share of blessings explained and the share of runs that led to one. */
export function f1(evaluation: ForecastEvaluation): number {
  const recall = evaluation.drops > 0 ? evaluation.attributed / evaluation.drops : 0;
  const precision = evaluation.runs > 0 ? evaluation.runsWithDrop / evaluation.runs : 0;
  return recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
}

/** The thresholds a sweep tries, around the defaults. */
export function sweepGrid(base: ReplayArgs): Array<{ tracker: SpireRunOptions; attribution: AttributionOptions }> {
  const grid: Array<{ tracker: SpireRunOptions; attribution: AttributionOptions }> = [];
  for (const minRunSize of [6, 7, 8, 9, 10]) {
    for (const linkGapMin of [3, 5, 8]) {
      for (const leftFraction of [0.3, 0.4, 0.5]) {
        for (const windowMin of [45, 60, 90]) {
          grid.push({
            tracker: { ...base.tracker, minRunSize, linkGapMs: linkGapMin * MIN, leftFraction },
            attribution: { ...base.attribution, windowMs: windowMin * MIN },
          });
        }
      }
    }
  }
  return grid;
}

function runLines(result: ReplayResult): string[] {
  const lines = result.runs.map(
    (run) =>
      `run ${stamp(run.startedAt)} -> ${clock(run.endedAt)} (${humanClock(run.endedAt - run.startedAt)}) ` +
      `peak ${run.peak}/${run.size}, ${run.horde} Horde${run.guild ? `, mostly <${run.guild}>` : ""}, ${run.reason}` +
      (run.baseline ? ", baseline" : ""),
  );
  const blind = new Map(result.blind.map((b) => [b.dropAt, b.coverage]));
  for (const attribution of result.attributions) {
    const coverage = blind.get(attribution.dropAt);
    lines.push(
      `blessing ${stamp(attribution.dropAt)} <- ` +
        (attribution.run !== null
          ? `run from ${clock(attribution.run.startedAt)}, ${signedClock(attribution.lagMs)} after it left`
          : coverage !== undefined
            ? `blind (the watch saw ${Math.round(coverage * 100)}% of the Spire before it)`
            : "no run"),
    );
  }
  return lines;
}

/** "-40m" before a moment, "0m" at it. */
const before = (ms: number): string => (ms === 0 ? "0m" : `-${humanClock(ms)}`);

function contextLines(snapshots: readonly SpireSnapshot[], result: ReplayResult): string[] {
  const lines: string[] = [];
  for (const attribution of result.attributions) {
    const steps = occupancyBefore(snapshots, attribution.dropAt, 3 * 60 * MIN, 10 * MIN);
    lines.push(`blessing ${stamp(attribution.dropAt)} - in the Spire (Horde) every 10m over the 3h before:`);
    lines.push(`  ${steps.map((s) => `${before(s.beforeMs)} ${s.present}(${s.horde})`).join("  ")}`);
  }
  return lines;
}

/** The report for one replay, as the lines the CLI prints. */
export function replayReport(snapshots: readonly SpireSnapshot[], blessingsAt: readonly number[], args: ReplayArgs): string[] {
  const result = replaySpire(snapshots, blessingsAt, args);
  if (result === null) return ["No Spire readings in that span - is WOW_SPIRE_WATCH on, and has it run?"];
  const lines = [
    `Spire replay: ${stamp(result.from)} -> ${stamp(result.to)}, ${snapshots.length} readings, ` +
      `${result.evaluation.drops} blessings heard in that span`,
    describeOptions(args.tracker, args.attribution),
    formatScore(result.evaluation),
  ];
  if (args.runs) lines.push("", ...runLines(result));
  if (args.context) lines.push("", ...contextLines(snapshots, result));
  if (args.sweep) {
    const ranked = sweepGrid(args)
      .flatMap((options) => {
        const swept = replaySpire(snapshots, blessingsAt, options);
        return swept ? [{ options, evaluation: swept.evaluation }] : [];
      })
      .sort((x, y) => f1(y.evaluation) - f1(x.evaluation));
    lines.push("", `Sweep, best first (F1 of blessings explained and runs that led to one):`);
    for (const { options, evaluation } of ranked.slice(0, 15)) {
      lines.push(`  F1 ${f1(evaluation).toFixed(2)}  ${formatScore(evaluation)}`);
      lines.push(`      ${describeOptions(options.tracker, options.attribution)}`);
    }
  }
  return lines;
}
