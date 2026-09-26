import type { BotConfig } from "./config.js";
import { describeError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { FaireAnswer } from "./darkmoon/observation.js";
import { AlertDelivery } from "./notify/alert-delivery.js";
import { isAnnounced, yelledInCapitals } from "./notify/raid-alert-reach.js";
import {
  formatBuffAlert,
  formatBuffDroppedWhisper,
  formatBuffWhisper,
  formatCapitalStatusYell,
  formatRaidDisbanded,
  formatRaidDisbandedWhisper,
  formatRaidEnding,
  formatRaidEndingWhisper,
  formatWarchiefBlessingWhisper,
  withUnsubscribeHint,
} from "./notify/format.js";
import { formatHeartbeat } from "./watcher/heartbeat.js";
import { evaluateTimer, improvedEstimate, typicalClearText } from "./watcher/timer-eval.js";
import { splitByFaction, type FactionSplit } from "./watcher/faction.js";
import { raidEndingDue } from "./watcher/raid-ending.js";
import { summarizeDepartures } from "./watcher/presence.js";
import { noteLairPoll, type LairActivity } from "./watcher/drop-origin.js";
import { shouldBroadcast, type BroadcastLedger } from "./watcher/broadcast-ledger.js";
import { clearedRaidEvent, formedRaidEvent, type RaidEvent } from "./watcher/raid-events.js";
import { RaidAlertPolicy } from "./watcher/raid-alert-policy.js";
import { FACTIONS, type Faction } from "./watcher/buff-store.js";
import { isPlausibleClear, type DurationStore } from "./watcher/duration-store.js";
import { confirmingKills } from "./chronicle/confirm.js";
import { cleanOnyxiaKills } from "./chronicle/parse.js";
import type { WhisperQueue } from "./chat/whisper-queue.js";
import type { LairView } from "./watcher/roster-source.js";
import type { RaidLifecycleEvent } from "./watcher/raid-tracker.js";
import type { ConfirmedClear, PendingDeparture } from "./watcher/clear-tracker.js";
import type { DetectionLane, LaneChronicle, YellSink } from "./lanes.js";
import type { BuffTracker } from "./watcher/buff-tracker.js";
import type { RaidStateStore } from "./watcher/raid-state-store.js";
import type { LockoutStore } from "./watcher/lockout-store.js";
import type { SnapshotStore } from "./watcher/snapshot-store.js";
import type { SubscriberStore } from "./subscribers/store.js";
import type { UserLedger } from "./subscribers/user-ledger.js";
import type { GuildieStore } from "./subscribers/guildie-store.js";
import type { WhisperPool } from "./chat/whisper-pool.js";
import type { NotifyMessage } from "./notify/notifier.js";
import { capitalStatusFaire } from "./darkmoon/format.js";

/**
 * Exactly what the raid service needs from the connection — a narrow view of index.ts's
 * ConnectionServices (which is structurally assignable to this). Declared here, from the source
 * modules, so the service never imports the entry point for a type.
 */
export interface RaidServiceDeps {
  readonly lanes: readonly DetectionLane[];
  readonly chronicle: LaneChronicle | null;
  readonly buffTracker: BuffTracker;
  readonly broadcasts: BroadcastLedger;
  readonly raidStateStore: RaidStateStore;
  readonly lockoutStore: LockoutStore;
  readonly durationStore: DurationStore;
  readonly snapshots: SnapshotStore;
  readonly store: SubscriberStore;
  readonly userLedger: UserLedger;
  readonly inviteLedger: UserLedger;
  readonly guildieStore: GuildieStore;
  readonly whisperPool: WhisperPool;
  readonly yellSink: YellSink;
  readonly lairActivity: LairActivity;
  /** Where the Darkmoon Faire was last seen, for the capital yell. Undefined = not tracked, and
   *  the yell simply omits the line. */
  readonly faireAnswer?: (now: number) => FaireAnswer;
  readonly push: (message: NotifyMessage, factions?: readonly Faction[]) => Promise<void>;
}

/** How many recent clears the self-improving timer evaluates over. */
const TIMER_EVAL_WINDOW = 200;
/** How often the heartbeat stat line is logged. */
const HEARTBEAT_MS = 15 * 60_000;

/** Whole minutes, for the human-readable log/alert wording. */
function mins(ms: number): number {
  return Math.round(ms / 60_000);
}

/**
 * The raid poll-tick orchestrator (RAID_ARCHITECTURE.md step 6): given a LairView it runs the
 * observe -> decide -> deliver pipeline (formation/clear alerts, the disband stand-down, the
 * Chronicle early-confirm and the about-to-clear heads-up), owns the buff-drop announce and the
 * capital status yell, and drives the periodic heartbeat log. Built from the connection's services
 * plus the whisper broadcaster and a getter for the late-bound fallback queue; index.ts wires the
 * poll loop, the buffDropSink and the yell timer to the handles it returns.
 */
export function createRaidService(
  services: RaidServiceDeps,
  config: BotConfig,
  logger: Logger,
  broadcastWhisper: (names: readonly string[], message: string, faction: Faction | null, cities?: readonly Faction[], maxAgeMs?: number) => void,
  getWhisperQueue: () => WhisperQueue | null,
) {
  const { lanes, chronicle, buffTracker, broadcasts, raidStateStore, lockoutStore, durationStore, snapshots, store, userLedger, inviteLedger, guildieStore, push, whisperPool, yellSink, faireAnswer } = services;
  const lastChronicleCheck = new Map<string, number>();
  let lastHeartbeatAt = 0;

    // The single fan-out: Discord post + per-capital yell + per-side subscriber whisper. The announce
    // functions below only pick formatters; HOW it's sent lives in AlertDelivery.
    const delivery = new AlertDelivery({
      push,
      yell: (city, text) => yellSink[city]?.(text),
      whispersEnabled: config.whispersEnabled,
      subscribers: () => store.all(),
      broadcastWhisper,
      logger,
    });

    // The ONE gate for raid alerts — per-raid dedup + buff cooldown + which cities — so the announce
    // functions below just hand it the event and act on the cities it returns. See RAID_ARCHITECTURE.md.
    const alertPolicy = new RaidAlertPolicy({
      lastBroadcast: (city, kind) => broadcasts.last(city, kind),
      lastBuffDropAt: (city) => buffTracker.lastDropAt(city),
      cooldownMs: config.buffCooldownMs,
      dedupMs: config.broadcastDedupMs,
      logger,
    });

    // A buff-parking alert: post to the Onyxia channel (pinging @alliance/@horde per open
    // city) and whisper in-game subscribers of that side — and, for a clear alone, yell in each
    // open capital. The caller already deduped `cities` against the ledger, so this fires at most
    // once per cycle.
    const announceBuff = async (event: RaidEvent, cities: readonly Faction[]): Promise<void> => {
      // The "raid starting" alert quotes how long a raid usually takes, so a reader can judge
      // whether to park now; the "raid ended" alert already carries its own duration.
      const typical = event.kind === "raid-forming" ? await typicalClear() : undefined;
      await delivery.sendCityAlert({
        label: event.kind,
        discord: formatBuffAlert(event, cities, typical),
        cities,
        // Yelled in the capitals only when it is the one raid alert that is (see notify/raid-alert-reach.ts).
        ...(yelledInCapitals(event.kind) ? { yellFor: (city: Faction) => formatBuffWhisper(event, [city], typical) } : {}),
        whisperFor: (groupCities) => formatBuffWhisper(event, groupCities, typical),
        // Tag with the cities this park-now is about, so a buff dropping there purges it as stale.
        whisperMaxAgeMs: config.whisperMaxAgeMs,
      });
    };

    // A buff DROP (heard on a listener, routed here via the sink): whisper that side's subs.
    const announceBuffDrop = (faction: Faction): Promise<void> => {
      // The buff is UP now, so any still-queued "park now to catch it" whispers for this side are
      // stale — purge them before sending the "it's up" message, or a subscriber would be told to
      // park after being told it already dropped.
      const dropped = whisperPool.dropForFaction(faction) + (getWhisperQueue()?.dropForFaction(faction) ?? 0);
      if (dropped > 0) logger.info(`dropped ${dropped} stale park-now whisper(s) for ${faction} — buff is up`);
      // A drop whisper delivered minutes late (throttle backlog) is the Owlofelune case — expire it.
      return delivery.sendFactionWhisper(
        faction,
        formatBuffDroppedWhisper(faction),
        config.whisperMaxAgeMs,
      );
    };

    // Rend's head turned in: the Warchief's Blessing is up in Orgrimmar. Horde-only, so only the Horde
    // (and both-sides) subscribers hear of it; no park-now whispers to purge — no raid led up to it.
    const announceWarchiefBlessing = (): Promise<void> =>
      delivery.sendFactionWhisper(
        "horde",
        formatWarchiefBlessingWhisper(),
        config.whisperMaxAgeMs,
      );

    // The raid in progress for a faction (from the lane covering it), or null.
    const raidStateFor = (faction: Faction, now: number): { number: number | null; elapsedMs: number } | null => {
      for (const lane of lanes) {
        if (!lane.cities.includes(faction)) continue;
        const elapsedMs = lane.watch.raidElapsedMs(now);
        if (elapsedMs !== null) return { number: lane.watch.raidNumber(), elapsedMs };
      }
      return null;
    };

    // The clear time a raid is predicted to take: the self-improving estimate (learned median with
    // its measured bias corrected out) once enough raids are on record, else the config guess. Feeds
    // the "about to clear" heads-up — which fires once a raid has been in the lair to within the
    // configured lead of this prediction.
    const predictRaidDurationMs = async (): Promise<number> => {
      const series = await durationStore.recent(TIMER_EVAL_WINDOW).catch(() => []);
      return improvedEstimate(series.map((d) => d.ms), config.raidLearnMinSamples) ?? config.raidDurationEstimateMs;
    };

    // The reader-facing "how long a raid usually takes" range ("30-50m", or "~45m" before enough
    // data) for the alerts, so a reader can judge whether to park now or come back.
    const typicalClear = async (): Promise<string> => {
      const series = await durationStore.recent(TIMER_EVAL_WINDOW).catch(() => []);
      return typicalClearText(series.map((d) => d.ms), config.raidDurationEstimateMs);
    };

    // Every ~10 min, yell a buff-status board in each capital: the raid in the lair (with a
    // "park" nudge — every clear can drop a fresh buff) and where the faire is, plus a
    // subscribe/discord CTA — or nothing, with neither to tell of. Reaches everyone standing in the
    // city, not just subscribers.
    const yellCapitalStatus = async (): Promise<void> => {
      if (!config.whispersEnabled) return;
      const now = Date.now();
      const typical = await typicalClear();
      // A recent look is shouted as fact, an older one with its age; nothing within a week, nothing.
      const answer = faireAnswer?.(now);
      const faire = answer ? capitalStatusFaire(answer, now) : null;
      for (const faction of FACTIONS) {
        const yell = yellSink[faction];
        if (!yell) continue; // no listener parked in this capital right now
        const raid = raidStateFor(faction, now);
        const status = formatCapitalStatusYell(faction, raid, raid ? typical : undefined, faire);
        if (status) yell(status);
      }
    };

    // One detection lane: census, then run each raid event through the per-cycle dedup
    // before it becomes a park-in-the-city alert.
    const processLane = async (
      lane: DetectionLane,
      split: FactionSplit,
      complete: boolean,
      now: number,
    ): Promise<void> => {
      const { events, census } = lane.watch.observe({ present: lane.players(split), complete, at: now });

      // Persist the raid in progress (or clear it) so a restart resumes exactly here.
      void raidStateStore
        .save(lane.label, lane.watch.raidStateSnapshot())
        .catch((error) => logger.debug(`raid state save: ${describeError(error)}`));
      // Persist the lockout ledger too — so a redeploy doesn't clear the locks and let a just-cleared
      // raid's lingering members re-form a phantom. Saved even when no raid is tracked (it outlives one).
      void lockoutStore
        .save(lane.label, lane.watch.lockoutSnapshot())
        .catch((error) => logger.debug(`lockout save: ${describeError(error)}`));

      // Followed a blind gap: the tracker already resumed-or-discarded its raid; skip this read so a
      // crash-and-refill isn't read as a raid starting or ending.
      if (census.blackout) {
        logger.warn(`${lane.label}: recovered after a ~${mins(census.gapMs)}m blind gap — re-baselined`);
        return;
      }

      if (census.arrivals.length > 0 || census.departures.length > 0) {
        const dep = summarizeDepartures(census.departures.filter((d) => d.confident));
        const depPart = dep
          ? ` -${dep.count} left (stayed ~${mins(dep.medianStayMs)}m, arrived within ${mins(dep.arrivalSpanMs)}m)`
          : "";
        const arrPart = census.arrivals.length > 0 ? ` +${census.arrivals.length} arrived` : "";
        const truncPart = complete ? "" : " [truncated: /who at cap]";
        logger.info(`census ${lane.label}: ${census.present} in zone${arrPart}${depPart}${truncPart}`);
      }

      // Gate an event against the per-cycle dedup, then announce it (channel post + that side's
      // subscribers + a city yell) and record it. Every candidate city is a real drop opportunity
      // (a clear can drop a fresh buff any time — no re-drop lockout on this server), so the only
      // gate is the dedup: drop any city we've already broadcast this kind for in the current
      // cycle. Keyed to the cycle (persisted in Mongo), so a redeploy, a wipe or roster churn
      // re-emitting the same event doesn't re-alert. A fresh drop for the city, or a stale
      // record, reopens it.
      const gateAndAnnounce = async (event: RaidEvent): Promise<void> => {
        // An alert not sent at all (the start, for now) is not recorded either: nobody was told of it,
        // so nothing later — a disband's stand-down — is owed for it.
        if (!isAnnounced(event.kind)) return;
        const raidNumber = event.number ?? null;
        const fresh = await alertPolicy.decide({ cities: lane.cities, kind: event.kind, raidNumber, label: lane.label, now });
        if (fresh.length === 0) return;
        await announceBuff(event, fresh);
        for (const city of fresh) {
          await broadcasts
            .record({
              city,
              kind: event.kind,
              cohortLabel: event.cohort.label,
              peak: event.cohort.peak,
              raidNumber,
              lastBroadcastAt: new Date(now),
            })
            .catch((error) => logger.error(`broadcast-ledger: ${describeError(error)}`));
        }
      };

      // The "about to clear" heads-up: a raid STILL in the lair has been in to within the lead of
      // its predicted clear, so a fresh Rallying Cry should drop soon. Deduped per cycle per city
      // like the park alerts, and independent of the forming alert (which fired much earlier, at
      // strength). Only ever called for a raid that is genuinely still in progress (the caller
      // gates on that), so it never nudges people to park for a raid that has finished.
      const announceRaidEnding = async (raidNumber: number | null, elapsedMs: number): Promise<void> => {
        // Fire ONCE per raid, surviving reconnects/restarts, and drop any side still within the buff
        // cooldown. The RaidAlertPolicy does both: per-raid dedup against the PERSISTED ledger (keyed
        // on the raid number, not the buff cycle, so a mid-raid buff drop — saved head / concurrent
        // raid — can't re-open it, and an in-memory map that re-fired on every relogin is gone), plus
        // the cooldown skip ("might end soon, park now" is wrong while no fresh Cry can drop). 0
        // cooldown (default) keeps both cities.
        const fresh = await alertPolicy.decide({ cities: lane.cities, kind: "raid-ending", raidNumber, label: lane.label, now });
        if (fresh.length === 0) return;
        const typical = await typicalClear();
        await delivery.sendCityAlert({
          label: "raid-ending",
          discord: formatRaidEnding(raidNumber, fresh, elapsedMs, typical),
          cities: fresh,
          ...(yelledInCapitals("raid-ending")
            ? { yellFor: (city: Faction) => formatRaidEndingWhisper(raidNumber, [city], elapsedMs, typical) }
            : {}),
          whisperFor: (groupCities) => formatRaidEndingWhisper(raidNumber, groupCities, elapsedMs, typical),
          whisperMaxAgeMs: config.whisperMaxAgeMs,
        });
        for (const city of fresh) {
          await broadcasts
            .record({ city, kind: "raid-ending", cohortLabel: "a raid", peak: 0, raidNumber, lastBroadcastAt: new Date(now) })
            .catch((error) => logger.error(`broadcast-ledger: ${describeError(error)}`));
        }
      };

      // The tracker emits the authoritative lifecycle events, roster-driven. A "formed" fires the
      // poll a raid reaches STRENGTH and first has a number (so the alert names it the same #N its
      // clear will); a "cleared" is a sustained roster departure, handled below. Never both in one
      // poll. The sustained clear carries killConfirmed:false — a Chronicle early-confirm sets it
      // true on the branch below.
      let cleared: Extract<RaidLifecycleEvent, { kind: "cleared" }> | null = null;
      for (const event of events) {
        if (event.kind === "formed") await gateAndAnnounce(formedRaidEvent(event.peak, event.number));
        else cleared = event;
      }

      // A real, COMPLETED clear drives the park-now alert, the recap, and the duration sample.
      // It arrives one of two ways: the ClearTracker's sustained wait (roster gone past the
      // wipe-runback window), or a Chronicle early-confirm below. Same handling either way; the
      // plausibility floor/ceiling guard both. `killConfirmed` only changes the alert wording.
      // A raid that formed and got a "get ready to park" alert, but left too soon to have really
      // cleared Onyxia, is a DISBAND — no park-now, no duration sample, and a stand-down for the
      // cities we told to park (found via the forming broadcast for this cycle; a city where a buff
      // dropped won't match, so a real clear never triggers a stand-down). Purges the queued park
      // whispers so nobody waits for a buff that isn't coming.
      const handleDisband = async (clear: ConfirmedClear): Promise<void> => {
        logger.info(
          `raid #${clear.number ?? "?"} disbanded: left after ~${mins(clear.durationMs)}m (< ${mins(config.raidDisbandMs)}m) — not a real clear, not recorded`,
        );
        const notified: Faction[] = [];
        for (const city of lane.cities) {
          const buffDropAt = await buffTracker.lastDropAt(city);
          // Told of this raid this cycle — by its start, or by a "might end soon" sent before it gave up.
          for (const kind of ["raid-forming", "raid-ending"] as const) {
            const told = await broadcasts.last(city, kind);
            if (!shouldBroadcast(told, buffDropAt, now, config.broadcastDedupMs)) {
              notified.push(city);
              break;
            }
          }
        }
        if (notified.length === 0) return; // no alert went out this cycle — nobody was told to park
        const line = formatRaidDisbandedWhisper(clear.number, clear.durationMs);
        for (const city of notified) {
          whisperPool.dropForFaction(city);
          getWhisperQueue()?.dropForFaction(city);
          if (yelledInCapitals("raid-disbanded")) yellSink[city]?.(line);
        }
        void push(formatRaidDisbanded(clear.number, clear.durationMs), notified);
        if (config.whispersEnabled) {
          try {
            const subs = (await store.all()).filter((s) => notified.some((c) => s.factions.includes(c)));
            if (subs.length > 0) {
              broadcastWhisper(subs.map((s) => s.name), withUnsubscribeHint(line), notified[0] ?? null, notified, config.whisperMaxAgeMs);
            }
          } catch (error) {
            logger.error(`subscribers: ${describeError(error)}`);
          }
        }
      };

      const handleConfirmedClear = async (clear: ConfirmedClear, killConfirmed: boolean): Promise<void> => {
        const ms = clear.durationMs;
        const CEILING_MS = 6 * 60 * 60_000; // a single Onyxia clear is not 6h+ — that's a merge/bug
        if (!isPlausibleClear(ms, config.raidMinClearMs)) {
          logger.info(
            `raid clear ignored: ~${mins(ms)}m is below the ${mins(config.raidMinClearMs)}m floor — churn, not a real clear`,
          );
          return;
        }
        if (ms > CEILING_MS) {
          logger.info(`raid clear ignored: ~${mins(ms)}m exceeds the ${mins(CEILING_MS)}m ceiling — likely a merge`);
          return;
        }
        // Too short to be a real Onyxia clear (unless Chronicle proved the kill) → a disband.
        if (!killConfirmed && ms < config.raidDisbandMs) {
          await handleDisband(clear);
          return;
        }
        // One "Onyxia raid has ended" alert per cycle (deduped) — it carries the recap (number +
        // duration) AND the park CTA in a single post; a clear can always produce a fresh buff, so
        // it hedges with "may". The number and duration ride the event into the message.
        await gateAndAnnounce(clearedRaidEvent(clear.peak, killConfirmed, clear.number, ms));
        void (async () => {
          await durationStore.record({ ms, ts: new Date(now) });
          const [learned, samples] = await Promise.all([
            durationStore.median(config.raidLearnMinSamples),
            durationStore.count(),
          ]);
          logger.info(
            `raid clear recorded: ~${mins(ms)}m (peak ${clear.peak}, ${samples} samples; ` +
              (learned
                ? `learned median ${mins(learned)}m now driving the about-to-clear heads-up`
                : `need ${config.raidLearnMinSamples} to switch off the ${mins(config.raidDurationEstimateMs)}m estimate`) +
              ")",
          );
        })().catch((error) => logger.debug(`duration: ${describeError(error)}`));
      };

      // During a departure WE detected (roster below the floor, still inside the sustained wait),
      // seek a Chronicle kill by one of this raid's roster to confirm the clear early. Throttled to
      // ~once a minute; records every fresh clean kill it sees (marking which confirmed this raid)
      // so `chroniclekills` keeps the history. Returns the early ConfirmedClear, or null — it can
      // never manufacture one, since confirmClearNow only fires on a pending departure.
      const tryChronicleConfirm = async (pending: PendingDeparture): Promise<ConfirmedClear | null> => {
        if (!chronicle) return null;
        const last = lastChronicleCheck.get(lane.label) ?? 0;
        if (now - last < 55_000) return null; // ~once a minute even if /who polls faster
        lastChronicleCheck.set(lane.label, now);
        let kills;
        try {
          kills = cleanOnyxiaKills(await chronicle.client.fetchRecentOnyxia(), chronicle.realm);
        } catch (error) {
          logger.debug(`chronicle: fetch failed (${describeError(error)})`);
          return null;
        }
        const known = await chronicle.store.knownLogIds(kills.map((k) => k.logId));
        const fresh = kills.filter((k) => !known.has(k.logId));
        if (fresh.length === 0) return null;
        const from = pending.formedAt - chronicle.matchWindowMs;
        const to = now + chronicle.matchWindowMs;
        const confirming = confirmingKills(fresh, pending.roster, from, to);
        const confirmingIds = new Set(confirming.map((k) => k.logId));
        const processedAt = new Date(now);
        for (const kill of fresh) {
          await chronicle.store
            .record({
              logId: kill.logId,
              realm: kill.realm,
              uploader: kill.uploader,
              at: kill.at,
              playerCount: kill.playerCount,
              matched: confirmingIds.has(kill.logId),
              processedAt,
            })
            .catch((error) => logger.debug(`chronicle store: ${describeError(error)}`));
        }
        return confirming.length > 0 ? lane.watch.confirmClearNow() : null;
      };

      if (cleared) {
        await handleConfirmedClear({ durationMs: cleared.durationMs, peak: cleared.peak, number: cleared.number }, false);
      } else if (chronicle) {
        const pending = lane.watch.pendingClear();
        if (pending) {
          const early = await tryChronicleConfirm(pending);
          if (early) {
            logger.info(
              `${lane.label}: Chronicle-confirmed clear #${early.number ?? "?"} (peak ${early.peak}) — skipping the ${mins(config.raidClearSustainedMs)}m wait`,
            );
            await handleConfirmedClear(early, true);
          }
        }
      }

      // About-to-clear heads-up — LAST, and only for a raid that is genuinely still in the lair.
      // If it just cleared above (elapsed is now null), or its roster is already leaving (a pending
      // departure — clearing or wiping), there is no fresh buff to park for, so we stay quiet.
      const endingElapsedMs = lane.watch.raidElapsedMs(now);
      // announceRaidEnding dedups once-per-raid against the persisted ledger, so this is safe to
      // reach every poll and across reconnects — it won't re-fire for a raid already announced.
      if (endingElapsedMs !== null && !lane.watch.pendingClear()) {
        const predictedMs = await predictRaidDurationMs();
        if (raidEndingDue(endingElapsedMs, predictedMs, config.raidEndingLeadMs)) {
          await announceRaidEnding(lane.watch.raidNumber(), endingElapsedMs);
        }
      }
    };

    const logHeartbeat = async (now: number): Promise<void> => {
      const [series, learnedMedianMs, subscribers, totalUsers, totalInvites, activeGuildies, buffs] = await Promise.all([
        durationStore.recent(TIMER_EVAL_WINDOW),
        durationStore.median(config.raidLearnMinSamples),
        store.all().then((all) => all.length),
        userLedger.count().catch(() => 0),
        inviteLedger.count().catch(() => 0),
        guildieStore.count().catch(() => 0),
        Promise.all(
          FACTIONS.map(async (faction) => {
            const dropAt = await buffTracker.lastDropAt(faction);
            const sinceLastDropMs = dropAt ? now - dropAt.getTime() : null;
            return { faction, sinceLastDropMs };
          }),
        ),
      ]);
      // Self-evaluate the learned timer: how well would its expanding-window median have
      // predicted each past clear? Logged so the overnight monitor shows whether it's good.
      const evaln = evaluateTimer(series.map((d) => d.ms), config.raidLearnMinSamples);
      logger.info(
        formatHeartbeat({
          subscribers,
          totalUsers,
          totalInvites,
          activeGuildies,
          samples: evaln.samples,
          learnedMedianMs,
          improvedMs: evaln.improvedEstimateMs,
          estimateMs: config.raidDurationEstimateMs,
          minSamples: config.raidLearnMinSamples,
          buffs,
          accuracy:
            evaln.evaluated > 0 && evaln.maeMs !== null && evaln.biasMs !== null
              ? { evaluated: evaln.evaluated, maeMs: evaln.maeMs, biasMs: evaln.biasMs }
              : null,
        }),
      );
    };

    const processRoster = async (view: LairView): Promise<void> => {
      const now = Date.now();
      const inZone = view.present; // players in the watch area; the source already filtered + logged it
      const complete = view.complete;

      // Persist the raw observation for offline replay/stats.
      void snapshots
        .record({ ts: new Date(now), present: inZone.length, complete, names: inZone.map((p) => p.name) })
        .catch((error) => logger.debug(`snapshot: ${describeError(error)}`));

      // Feed the shared lair signal so a later buff drop can tell a fresh kill (a raid was here)
      // from a saved-head turn-in (an empty lair), and spot a blind gap it must not guess across.
      noteLairPoll(services.lairActivity, inZone.length, now);

      // Surface the MongoDB-only stats into the logs on a slow cadence, so the
      // self-improving timer's progress and the buff state are observable at a glance.
      if (now - lastHeartbeatAt >= HEARTBEAT_MS) {
        lastHeartbeatAt = now;
        void logHeartbeat(now).catch((error) => logger.debug(`monitor: ${describeError(error)}`));
      }

      const split = splitByFaction(inZone);
      // In faction mode unmapped races belong to no lane; log them so a custom Turtle/
      // Octo race id can be added to the map. (Crossfaction's lair lane includes them.)
      if (config.realmType === "faction" && split.unknown.length > 0) {
        const races = [...new Set(split.unknown.map((player) => player.raceId))].join(", ");
        logger.info(`${split.unknown.length} in zone with unmapped race ids [${races}] — not attributed`);
      }
      for (const lane of lanes) {
        await processLane(lane, split, complete, now);
      }
    };

  return { onRoster: processRoster, announceBuffDrop, announceWarchiefBlessing, yellCapitalStatus };
}
