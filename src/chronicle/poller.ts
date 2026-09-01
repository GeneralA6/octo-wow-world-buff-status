import type { Logger } from "../logger.js";
import type { SnapshotStore } from "../watcher/snapshot-store.js";
import type { ChronicleClient } from "./client.js";
import { cleanOnyxiaKills } from "./parse.js";
import { reconcile, type Reconciliation } from "./reconcile.js";
import type { ChronicleStore, StoredKill } from "./store.js";
import type { OnyxiaKill } from "./types.js";

/**
 * One reconciliation pass: fetch Chronicle's recent Onyxia kills, keep our realm's clean ones,
 * drop the logs already processed (the window overlaps every poll), reconcile the rest against
 * the /who rosters from WHEN each kill happened, persist the matched/missed verdict, and return
 * a summary. Read-only toward the world — this never alerts anyone; it measures.
 */
export interface ChroniclePollerDeps {
  readonly client: ChronicleClient;
  readonly snapshots: SnapshotStore;
  readonly store: ChronicleStore;
  readonly realm: string;
  readonly matchWindowMs: number;
  readonly logger: Logger;
  /** Injectable clock for the processedAt stamp; defaults to Date.now. */
  readonly now?: () => number;
}

export interface PollSummary {
  /** Clean Onyxia kills on our realm currently in Chronicle's window. */
  readonly fetched: number;
  /** Of those, ones not processed before — acted on this poll. */
  readonly fresh: number;
  /** Fresh kills whose uploader we saw in the lair — raids we detected. */
  readonly confirmed: number;
  /** Fresh kills we didn't detect. */
  readonly missed: number;
  /** Approx distinct raids among the missed kills (uploads collapsed). */
  readonly distinctMissedRaids: number;
}

export async function pollChronicleOnce(deps: ChroniclePollerDeps): Promise<PollSummary> {
  const { client, snapshots, store, realm, matchWindowMs, logger } = deps;
  const clock = deps.now ?? Date.now;

  const kills = cleanOnyxiaKills(await client.fetchRecentOnyxia(), realm);
  const known = await store.knownLogIds(kills.map((k) => k.logId));
  const fresh = kills.filter((k) => !known.has(k.logId));

  if (fresh.length === 0) {
    logger.debug(`chronicle: ${kills.length} ${realm} kill(s) in window, none new`);
    return { fetched: kills.length, fresh: 0, confirmed: 0, missed: 0, distinctMissedRaids: 0 };
  }

  const [from, to] = coveringWindow(fresh, matchWindowMs);
  const snaps = await snapshots.between(new Date(from), new Date(to));
  const rec = reconcile(fresh, snaps, matchWindowMs);

  const confirmedIds = new Set(rec.confirmed.map((k) => k.logId));
  const processedAt = new Date(clock());
  for (const kill of fresh) {
    await store.record(stored(kill, confirmedIds.has(kill.logId), processedAt));
  }

  const summary: PollSummary = {
    fetched: kills.length,
    fresh: fresh.length,
    confirmed: rec.confirmed.length,
    missed: rec.missed.length,
    distinctMissedRaids: rec.distinctMissed,
  };
  logSummary(logger, realm, rec, summary);
  return summary;
}

/** [earliest kill - pad, latest kill + pad] — the span of snapshots the reconciler needs. */
function coveringWindow(kills: readonly OnyxiaKill[], padMs: number): [number, number] {
  const times = kills.map((k) => k.at.getTime());
  return [Math.min(...times) - padMs, Math.max(...times) + padMs];
}

function stored(kill: OnyxiaKill, matched: boolean, processedAt: Date): StoredKill {
  return {
    logId: kill.logId,
    realm: kill.realm,
    uploader: kill.uploader,
    at: kill.at,
    playerCount: kill.playerCount,
    matched,
    processedAt,
  };
}

function logSummary(logger: Logger, realm: string, rec: Reconciliation, s: PollSummary): void {
  const line = `chronicle: ${s.fresh} new ${realm} Onyxia kill(s) — ${s.confirmed} confirmed, ${s.missed} missed`;
  if (rec.missed.length === 0) {
    logger.info(line);
    return;
  }
  const uploaders = rec.missed.map((k) => k.uploader).slice(0, 5).join(", ");
  logger.info(`${line} (~${s.distinctMissedRaids} missed raid(s); uploaders: ${uploaders})`);
}
