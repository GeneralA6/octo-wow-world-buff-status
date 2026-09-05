import { connect, type Socket } from "node:net";
import { loadConfig, parseAddress, type BotConfig, type ListenerConfig } from "./config.js";
import { createLogger, prefixed, type Logger } from "./logger.js";
import { describeError, FatalError, VersionMismatchError } from "./errors.js";
import { AuthClient } from "./net/auth-client.js";
import { WorldClient } from "./net/world-client.js";
import { resolveBuild } from "./net/client-resolver.js";
import type { NotifyMessage } from "./notify/notifier.js";
import { DiscordDmSender } from "./notify/discord-dm.js";
import {
  formatBuffAlert,
  formatBuffDropped,
  formatBuffDroppedWhisper,
  formatBuffWhisper,
  formatRaidEnding,
  formatRaidEndingWhisper,
  formatRaidDisbanded,
  formatRaidDisbandedWhisper,
  formatCapitalStatusYell,
  formatFeedbackPost,
  formatGuildWelcome,
  formatHeadIncoming,
  formatServerDown,
  formatServerUp,
} from "./notify/format.js";
import { InMemoryFeedbackStore, MongoFeedbackStore, type FeedbackStore } from "./feedback/store.js";
import { groupByRelevantCities } from "./notify/faction-routing.js";
import { clearedRaidEvent, formedRaidEvent, type RaidEvent } from "./watcher/raid-tracker.js";
import { summarizeDepartures } from "./watcher/presence.js";
import { fetchRoster, type Roster } from "./watcher/roster.js";
import { PresenceSweeper } from "./watcher/presence-sweep.js";
import type { WhoPlayer, WhoQuery, WhoResult } from "./protocol/who.js";
import { nearestGameObject, parseUpdateObject, type WorldGameObject, type WorldPoint } from "./protocol/update-object.js";
import { InMemorySnapshotStore, MongoSnapshotStore, type SnapshotStore } from "./watcher/snapshot-store.js";
import {
  FACTIONS,
  InMemoryBuffStore,
  MongoBuffStore,
  type BuffStore,
  type Faction,
} from "./watcher/buff-store.js";
import { matchBuffYell } from "./watcher/buff-yell.js";
import { formatHeartbeat } from "./watcher/heartbeat.js";
import {
  InMemoryDurationStore,
  MongoDurationStore,
  isPlausibleClear,
  type DurationStore,
} from "./watcher/duration-store.js";
import { RaidWatch, type RaidWatchOptions } from "./watcher/raid-watch.js";
import { classifyDropOrigin, newLairActivity, noteLairPoll, type LairActivity } from "./watcher/drop-origin.js";
import { parseHeadIncoming, isOnyxiaHead } from "./watcher/lft-signals.js";
import { printableAsciiRuns } from "./protocol/chat.js";
import { evaluateTimer, improvedEstimate, typicalClearText } from "./watcher/timer-eval.js";
import { isCommandError, isWhisperThrottle } from "./chat/system-error.js";
import { HttpChronicleClient, type ChronicleClient } from "./chronicle/client.js";
import { cleanOnyxiaKills } from "./chronicle/parse.js";
import { confirmingKills } from "./chronicle/confirm.js";
import { MongoChronicleStore, type ChronicleStore } from "./chronicle/store.js";
import type { ConfirmedClear, PendingDeparture } from "./watcher/clear-tracker.js";
import {
  InMemoryRaidCounterStore,
  MongoRaidCounterStore,
  type RaidCounterStore,
} from "./watcher/raid-counter-store.js";
import {
  InMemoryRaidStateStore,
  MongoRaidStateStore,
  type RaidStateStore,
} from "./watcher/raid-state-store.js";
import { factionOfRace, splitByFaction, type FactionSplit } from "./watcher/faction.js";
import { raidEndingDue } from "./watcher/raid-ending.js";
import {
  InMemoryBroadcastLedger,
  MongoBroadcastLedger,
  shouldBroadcast,
  type BroadcastLedger,
} from "./watcher/broadcast-ledger.js";
import { CommandRouter } from "./chat/command-router.js";
import { Outreach } from "./chat/outreach.js";
import { InMemoryIntroStore, MongoIntroStore, type IntroStore } from "./chat/intro-store.js";
import { InMemoryUserLedger, MongoUserLedger, type UserLedger } from "./subscribers/user-ledger.js";
import { InMemoryGuildieStore, MongoGuildieStore, type GuildieStore } from "./subscribers/guildie-store.js";
import { WhisperQueue } from "./chat/whisper-queue.js";
import { WhisperPool } from "./chat/whisper-pool.js";
import { InMemorySubscriberStore } from "./subscribers/memory-store.js";
import { MongoSubscriberStore } from "./subscribers/mongo-store.js";
import { needsFactionResolution, subscriberKey, type Subscriber, type SubscriberStore } from "./subscribers/store.js";
import { jitter } from "./schedule.js";
import { DownTracker } from "./down-tracker.js";
import { ServerMonitor } from "./server-monitor.js";

/** Client identity values that self-heal from the CDN across OctoWoW patches. */
interface ClientValues {
  build: number;
  worldBuild: number;
  integrityChecksum: Buffer | null;
}

/** Cross-attempt state so the self-heal doesn't re-hit the CDN or re-alert in a loop. */
interface HealState {
  /** Monotonic time of the last CDN build check, to rate-limit hits. */
  lastCheckMs: number;
  /** True once we've alerted that a rejection can't be healed, so we don't repeat it. */
  alertedStuck: boolean;
}

/** +/- 15% randomization on the poll interval so the cadence isn't a fixed tick. */
const POLL_JITTER_RATIO = 0.15;

/** Don't re-check the CDN build more often than this while a rejection persists. */
const HEAL_CHECK_COOLDOWN_MS = 5 * 60_000;

/** How many recent clears the timer self-evaluation replays each heartbeat. */
const TIMER_EVAL_WINDOW = 200;

/** Suppress a repeat LFT head-incoming alert for the same turn-in within this window — the channel
 *  relays/retransmits the same OB_INC many times, and a turn-in is a momentary event. */
const HEAD_INCOMING_DEDUP_MS = 15 * 60_000;

/** Consecutive reconnect failures before a supervisor alerts the errors channel that it's
 *  down (backoff caps at 60s, so this is a couple of minutes of sustained failure, not a blip). */
const DOWN_ALERT_THRESHOLD = 5;

/** Max time from connecting to reaching in-world before the handshake is deemed stalled. */
const WORLD_READY_TIMEOUT_MS = 30_000;

/** How often the watcher logs its monitoring heartbeat (subs, learned timer, buffs). */
const HEARTBEAT_MS = 15 * 60_000;

/** How often the active faction resolver /who's ONE both-faction subscriber, and — when the
 *  backlog is empty — how long it waits before re-scanning for new stragglers. Deliberately slow:
 *  it runs on Bufftracker's own /who (serialized behind the raid poll), so this is a gentle,
 *  low-priority background cleanup, not a race to drain the backlog. */
const FACTION_RESOLVE_MS = 2 * 60_000;
const FACTION_RESOLVE_IDLE_RESCAN_MS = 10 * 60_000;

/** Re-check for a nearby object this often, and give up after this many tries. The
 *  object burst can arrive over several seconds, so we poll rather than wait once. */
const OBJECT_POLL_MS = 2_500;
const OBJECT_POLL_MAX = 12;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Milliseconds to whole minutes, for readable census logging. */
function mins(ms: number): number {
  return Math.round(ms / 60_000);
}

function resolveWorldTarget(
  config: BotConfig,
  realms: readonly { name: string; address: string }[],
  logger: Logger,
): { host: string; port: number } {
  if (config.worldHost) {
    return { host: config.worldHost, port: config.worldPort ?? 8085 };
  }
  const realm =
    realms.find((entry) => entry.name.toLowerCase() === config.realm.toLowerCase()) ?? realms[0];
  if (!realm) throw new FatalError("auth: server returned no realms");
  const target = parseAddress(realm.address);
  logger.info(`world server: ${realm.name} @ ${target.host}:${target.port}`);
  return target;
}

function connectSocket(host: string, port: number, timeoutMs = 15_000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out connecting to ${host}:${port}`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * One detection lane: a raid watch over some slice of the lair, and the city buffs it
 * gates against. Crossfaction is one lane over the whole lair gating both cities;
 * faction realm is one lane per side, each gating its own city.
 */
interface DetectionLane {
  readonly label: string;
  readonly watch: RaidWatch;
  readonly cities: readonly Faction[];
  players(split: FactionSplit): readonly WhoPlayer[];
}

/** A buff drop is heard on a listener but must be whispered from the watcher — the
 *  watcher fills this sink when in world so the listener's recordBuff can reach it. */
interface BuffDropSink {
  notify: ((faction: Faction, appliedAt: Date, savedHead: boolean) => void) | null;
}

/** Each listener (parked in its capital) registers a /yell function for its own side once
 *  it knows it; the watcher yells through it to broadcast to everyone nearby in the city. */
type YellSink = Partial<Record<Faction, (message: string) => void>>;

/** Runs one /who and returns the result — a socket's queued lookup. */
type WhoRunner = (query: WhoQuery) => Promise<WhoResult>;

/**
 * A registry of the listeners' /who runners. A faction lookup that can't be answered from the
 * listener's own side (a direct whisper to Bufftracker, or a faction-less listener) borrows a
 * listener's socket through here instead of Bufftracker's, so it never contends with the raid
 * poll — the thing whose /who timing out actually matters. Empty (no listener in world) falls
 * back to Bufftracker's own /who.
 */
class ListenerWho {
  readonly #runners = new Map<string, WhoRunner>();
  register(id: string, run: WhoRunner): void {
    this.#runners.set(id, run);
  }
  unregister(id: string): void {
    this.#runners.delete(id);
  }
  /** Any registered listener runner (they're cross-faction-capable), or null if none is up. */
  any(): WhoRunner | null {
    for (const run of this.#runners.values()) return run;
    return null;
  }
  /** Every registered listener runner — so the raid poll can spread its class slices across their
   *  idle sockets, keeping each socket's /who count under the server's per-socket throttle. */
  all(): WhoRunner[] {
    return [...this.#runners.values()];
  }
}

/** Chronicle early-confirm dependencies, or null when it's off (no Mongo / disabled). */
interface LaneChronicle {
  readonly client: ChronicleClient;
  readonly store: ChronicleStore;
  readonly realm: string;
  /** How far a kill's pull time may sit from the raid's span and still count as this raid's. */
  readonly matchWindowMs: number;
}

/** Everything a connection needs beyond config: shared state and the alert sinks. */
interface ConnectionServices {
  readonly lanes: readonly DetectionLane[];
  /** Chronicle early-confirm, or null when off. */
  readonly chronicle: LaneChronicle | null;
  /** Listener sockets Bufftracker can borrow for a faction /who, off its own raid-poll socket. */
  readonly listenerWho: ListenerWho;
  /** The listeners' whisper queues, pooled so a broadcast splits across them; Bufftracker falls
   *  back to its own queue only when the pool is empty. */
  readonly whisperPool: WhisperPool;
  readonly buffStore: BuffStore;
  readonly broadcasts: BroadcastLedger;
  readonly raidStateStore: RaidStateStore;
  readonly durationStore: DurationStore;
  readonly snapshots: SnapshotStore;
  readonly store: SubscriberStore;
  /** Lifetime distinct-subscriber count for the heartbeat stat (survives unsubscribing). */
  readonly userLedger: UserLedger;
  /** Lifetime distinct guild-invite count for the heartbeat stat. */
  readonly inviteLedger: UserLedger;
  /** Active count of bot-invited players currently in the guild (add on join, remove on leave). */
  readonly guildieStore: GuildieStore;
  readonly router: CommandRouter;
  readonly dm: DiscordDmSender;
  readonly outreach: Outreach;
  readonly buffDropSink: BuffDropSink;
  /** Shared lair-poll signal: the watcher stamps it each /who, the listener's recordBuff reads it to
   *  tell a fresh-kill drop from a saved-head turn-in (empty lair). */
  readonly lairActivity: LairActivity;
  readonly yellSink: YellSink;
  readonly push: (message: NotifyMessage, factions?: readonly Faction[]) => Promise<void>;
  /** Post an operational/error notice to the errors Discord channel (or log-only if unset). */
  readonly notifyAdmin: (title: string, body: string) => Promise<void>;
  /** Post a STAGED/test alert to the tests channel (falls back to errors). */
  readonly notifyTests: (title: string, body: string) => Promise<void>;
  readonly client: ClientValues;
}

/** One connection lifetime: log in, enter world, poll /who and serve whispers. */
async function runConnection(
  config: BotConfig,
  logger: Logger,
  services: ConnectionServices,
  // Fired once this connection reaches in-world. This is the realm-recovery signal — a stable
  // reconnect must announce "back up" WITHOUT waiting for the connection to later close, which is
  // exactly what the old post-close wiring got wrong (a healthy recovery never fired it).
  onConnected: () => void,
): Promise<void> {
  const { lanes, chronicle, listenerWho, whisperPool, buffStore, broadcasts, raidStateStore, durationStore, snapshots, store, userLedger, inviteLedger, guildieStore, router, dm, outreach, buffDropSink, yellSink, push, notifyAdmin, notifyTests, client } =
    services;
  // Throttles the per-lane Chronicle early-confirm check to ~once a minute even if /who polls faster.
  const lastChronicleCheck = new Map<string, number>();
  const { sessionKey, realms } = await new AuthClient(logger).login({
    host: config.authHost,
    port: config.authPort,
    username: config.account,
    password: config.password,
    integrityChecksum: client.integrityChecksum,
    build: client.build,
  });

  const target = resolveWorldTarget(config, realms, logger);
  const socket = await connectSocket(target.host, target.port);

  await new Promise<void>((resolve, reject) => {
    let pollTimer: NodeJS.Timeout | null = null;
    let statusYellTimer: NodeJS.Timeout | null = null;
    let factionResolveTimer: NodeJS.Timeout | null = null;
    let whisperQueue: WhisperQueue | null = null;
    // Presence sweep (route B): created once this connection is in-world, owns Bufftracker's friends
    // list, and is consulted before every broadcast to skip offline players. Per-connection — reset
    // on close. The cache lets clustered broadcasts reuse one sweep (name -> was-online + when).
    let presenceSweeper: PresenceSweeper | null = null;
    const presenceCache = new Map<string, { whisper: boolean; at: number }>();
    // The world server can accept the TCP connection but stall the handshake, and
    // there's no other timeout past connect — so bound the time to reach in-world.
    let readyTimer: NodeJS.Timeout | null = null;
    // Throttles the monitoring heartbeat; 0 so the first poll after connect logs one.
    let lastHeartbeatAt = 0;

    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (statusYellTimer) clearInterval(statusYellTimer);
      if (factionResolveTimer) clearInterval(factionResolveTimer);
      if (readyTimer) clearTimeout(readyTimer);
      whisperQueue?.stop();
      outreach.setChannel(null, null); // watcher going away — stop greeting through it
      router.setGuildInvite(null); // and stop offering guild invites until reconnected
      router.setFactionLookup(null); // and stop the /who-based faction detection
      router.setFactionDetect(null);
      buffDropSink.notify = null; // and stop routing buff-drop whispers until reconnected
      presenceSweeper = null; // its world client is going away; broadcasts fall back to whispering all
      if (error) reject(error);
      else resolve();
    };

    // Broadcast a whisper to many subscribers via the listener pool (splitting the load across
    // their separate throttle budgets), falling back to Bufftracker's own queue if no listener is
    // up. `cities` tags a park-now alert so a later buff drop there can purge it as stale.
    // Enqueue whisper targets in small batches so they round-robin across the listener pool (fanOut
    // splits a batch across members; one-at-a-time would pile on member 0). Falls back to the
    // watcher's own queue when the pool is empty.
    const WHISPER_BATCH = 8;
    const makeWhisperSink = (
      message: string,
      faction: Faction | null,
      cities?: readonly Faction[],
      maxAgeMs?: number,
    ): { add: (name: string) => void; flush: () => void } => {
      let buffer: string[] = [];
      const flush = (): void => {
        if (buffer.length === 0) return;
        const batch = buffer;
        buffer = [];
        if (whisperPool.fanOut(batch, message, faction, cities, maxAgeMs) === 0) {
          for (const name of batch) whisperQueue?.enqueue(name, message, cities, maxAgeMs);
        }
      };
      return {
        add: (name) => {
          buffer.push(name);
          if (buffer.length >= WHISPER_BATCH) flush();
        },
        flush,
      };
    };

    // Presence gate (route B): whisper everyone the sweep does not find explicitly offline, skipping
    // the offline (who'd only burn a throttle slot on an undeliverable whisper). STREAMED — each
    // online name is enqueued the instant the sweep confirms it, so the fast sweep overlaps the slow
    // throttled drain instead of blocking it (upfront-blocking would make the first alert wait for
    // the whole sweep, ~a name per realm round-trip). Fail-open on every path (feature off, no live
    // sweeper, sweep failure). Cached per name so a drop and its about-to-clear reuse one sweep.
    const broadcastWhisper = (
      names: readonly string[],
      message: string,
      faction: Faction | null,
      cities?: readonly Faction[],
      maxAgeMs?: number,
    ): void => {
      void (async () => {
        const sink = makeWhisperSink(message, faction, cities, maxAgeMs);
        const sweeper = presenceSweeper;
        if (!config.presenceEnabled || !sweeper) {
          for (const name of names) sink.add(name); // presence off — whisper everyone
          sink.flush();
          return;
        }
        const now = Date.now();
        const stale: string[] = [];
        for (const name of names) {
          const cached = presenceCache.get(name);
          if (!cached || now - cached.at > config.presenceCacheMs) stale.push(name);
          else if (cached.whisper) sink.add(name); // cached online — enqueue now; cached offline — skip
        }
        if (stale.length > 0) {
          const keep = await sweeper.sweep(stale, (name) => sink.add(name)); // stream the online ones
          for (const name of stale) presenceCache.set(name, { whisper: keep.has(name), at: now });
        }
        sink.flush();
      })().catch((error) => logger.error(`broadcast whisper: ${describeError(error)}`));
    };

    // A buff-parking alert: post to the Onyxia channel (pinging @alliance/@horde per open
    // city), yell in each open capital, and whisper in-game subscribers of that side. The
    // caller already deduped `cities` against the ledger, so this fires at most once per cycle.
    const announceBuff = async (event: RaidEvent, cities: readonly Faction[]): Promise<void> => {
      // The "raid starting" alert quotes how long a raid usually takes, so a reader can judge
      // whether to park now; the "raid ended" alert already carries its own duration.
      const typical = event.kind === "raid-forming" ? await typicalClear() : undefined;
      const message = formatBuffAlert(event, cities, typical);
      logger.info(`ALERT ${event.kind} (${cities.join("/")}): ${message.body}`);
      await push(message, cities);
      if (!config.whispersEnabled) return;

      // Yell in each open capital via its listener, so everyone standing there hears it.
      for (const city of cities) yellSink[city]?.(formatBuffWhisper(event, [city], typical));

      // Whisper the in-game subscribers, each hearing only their side.
      let subscribers: Subscriber[] = [];
      try {
        subscribers = await store.all();
      } catch (error) {
        logger.error(`subscribers: ${describeError(error)}`);
        return;
      }
      if (subscribers.length === 0) return;
      for (const { cities: groupCities, members } of groupByRelevantCities(subscribers, cities)) {
        const line = formatBuffWhisper(event, groupCities, typical);
        // Tag with the cities this park-now is about, so a buff dropping there purges it as stale.
        broadcastWhisper(members.map((s) => s.name), line, groupCities[0] ?? null, groupCities, config.whisperMaxAgeMs);
      }
    };

    // Whisper one side's in-game subscribers (used by buff drops).
    const notifyFactionSubscribers = async (faction: Faction, whisperLine: string): Promise<void> => {
      if (!config.whispersEnabled) return;
      let subscribers: Subscriber[] = [];
      try {
        subscribers = await store.all();
      } catch (error) {
        logger.error(`subscribers: ${describeError(error)}`);
        return;
      }
      subscribers = subscribers.filter((s) => s.factions.includes(faction));
      if (subscribers.length === 0) return;
      // A drop whisper delivered minutes late (throttle backlog) is the Owlofelune case — expire it.
      broadcastWhisper(subscribers.map((s) => s.name), whisperLine, faction, undefined, config.whisperMaxAgeMs);
    };

    // A buff DROP (heard on a listener, routed here via the sink): whisper that side's subs.
    const announceBuffDrop = (faction: Faction, savedHead: boolean): Promise<void> => {
      // The buff is UP now, so any still-queued "park now to catch it" whispers for this side are
      // stale — purge them before sending the "it's up" message, or a subscriber would be told to
      // park after being told it already dropped.
      const dropped = whisperPool.dropForFaction(faction) + (whisperQueue?.dropForFaction(faction) ?? 0);
      if (dropped > 0) logger.info(`dropped ${dropped} stale park-now whisper(s) for ${faction} — buff is up`);
      return notifyFactionSubscribers(
        faction,
        formatBuffDroppedWhisper(faction, config.author, config.discordServerInvite ?? undefined, savedHead),
      );
    };

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
    // "park" nudge — every clear can drop a fresh buff) or, when empty, how a drop happens, plus
    // a subscribe/discord CTA. Reaches everyone standing in the city, not just subscribers.
    const yellCapitalStatus = async (): Promise<void> => {
      if (!config.whispersEnabled) return;
      const now = Date.now();
      const typical = await typicalClear();
      for (const faction of FACTIONS) {
        const yell = yellSink[faction];
        if (!yell) continue; // no listener parked in this capital right now
        const raid = raidStateFor(faction, now);
        yell(formatCapitalStatusYell(faction, raid, raid ? typical : undefined));
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
      const obs = lane.watch.observe(lane.players(split), now, complete);

      // Persist the raid in progress (or clear it) so a restart resumes exactly here.
      void raidStateStore
        .save(lane.label, lane.watch.raidStateSnapshot())
        .catch((error) => logger.debug(`raid state save: ${describeError(error)}`));

      // Followed a blind gap: RaidWatch already re-baselined; skip this read so a
      // crash-and-refill isn't read as a raid starting or ending.
      if (obs.change.blackout) {
        logger.warn(`${lane.label}: recovered after a ~${mins(obs.change.gapMs)}m blind gap — re-baselined`);
        return;
      }

      if (obs.change.arrivals.length > 0 || obs.change.departures.length > 0) {
        const dep = summarizeDepartures(obs.change.departures.filter((d) => d.confident));
        const depPart = dep
          ? ` -${dep.count} left (stayed ~${mins(dep.medianStayMs)}m, arrived within ${mins(dep.arrivalSpanMs)}m)`
          : "";
        const arrPart = obs.change.arrivals.length > 0 ? ` +${obs.change.arrivals.length} arrived` : "";
        const truncPart = complete ? "" : " [truncated: /who at cap]";
        logger.info(`census ${lane.label}: ${obs.change.present} in zone${arrPart}${depPart}${truncPart}`);
      }

      // Gate an event against the per-cycle dedup, then announce it (channel post + that side's
      // subscribers + a city yell) and record it. Every candidate city is a real drop opportunity
      // (a clear can drop a fresh buff any time — no re-drop lockout on this server), so the only
      // gate is the dedup: drop any city we've already broadcast this kind for in the current
      // cycle. Keyed to the cycle (persisted in Mongo), so a redeploy, a wipe or roster churn
      // re-emitting the same event doesn't re-alert. A fresh drop for the city, or a stale
      // record, reopens it.
      const gateAndAnnounce = async (event: RaidEvent): Promise<void> => {
        const fresh: Faction[] = [];
        for (const city of lane.cities) {
          const last = await broadcasts.last(city, event.kind);
          const lastBuffDropAt = (await buffStore.current(city))?.appliedAt ?? null;
          if (shouldBroadcast(last, lastBuffDropAt, now, config.broadcastDedupMs)) fresh.push(city);
          else logger.info(`${lane.label} ${event.kind} for ${city} suppressed — already broadcast this cycle`);
        }
        if (fresh.length === 0) return;
        await announceBuff(event, fresh);
        for (const city of fresh) {
          await broadcasts
            .record({
              city,
              kind: event.kind,
              cohortLabel: event.cohort.label,
              peak: event.cohort.peak,
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
        // Fire ONCE per raid, and make that survive reconnects/restarts: dedup on the raid number
        // stored in the PERSISTED ledger, not in per-connection memory (an in-memory map re-fired
        // the heads-up on every relogin). Keyed on the raid number, not the buff cycle, so a
        // mid-raid buff drop (saved head / concurrent raid) still can't re-open it.
        const fresh: Faction[] = [...lane.cities];
        const anyCity = fresh[0];
        if (anyCity) {
          const prior = await broadcasts.last(anyCity, "raid-ending").catch(() => null);
          if (prior && prior.raidNumber != null && prior.raidNumber === raidNumber) return; // already told this raid
        }
        const typical = await typicalClear();
        const message = formatRaidEnding(raidNumber, fresh, elapsedMs, typical);
        logger.info(`ALERT raid-ending (${fresh.join("/")}): ${message.body}`);
        await push(message, fresh);
        if (config.whispersEnabled) {
          for (const city of fresh) {
            yellSink[city]?.(formatRaidEndingWhisper(raidNumber, [city], elapsedMs, typical));
          }
          try {
            const subscribers = await store.all();
            for (const { cities: groupCities, members } of groupByRelevantCities(subscribers, fresh)) {
              const line = formatRaidEndingWhisper(raidNumber, groupCities, elapsedMs, typical);
              broadcastWhisper(members.map((s) => s.name), line, groupCities[0] ?? null, groupCities, config.whisperMaxAgeMs);
            }
          } catch (error) {
            logger.error(`subscribers: ${describeError(error)}`);
          }
        }
        for (const city of fresh) {
          await broadcasts
            .record({ city, kind: "raid-ending", cohortLabel: "a raid", peak: 0, raidNumber, lastBroadcastAt: new Date(now) })
            .catch((error) => logger.error(`broadcast-ledger: ${describeError(error)}`));
        }
      };

      // Both authoritative alerts now come from the ClearTracker's roster-based state, not the
      // count/temporal detector — the detector's per-cohort events are prone to false transitions
      // (a guild crossing the split line, a flickery /who, a wipe). The detector's events are only
      // shadow-logged now:
      //  - FORMING fires from obs.formed — the poll a raid reaches STRENGTH and first has a number,
      //    so the alert names it the same #N its clear will (the detector's forming fires earlier,
      //    at minRaidSize, where the raid has no number yet);
      //  - CLEAR fires from obs.clear (below), the sustained roster departure.
      if (obs.formed) {
        await gateAndAnnounce(formedRaidEvent(obs.formed.peak, obs.formed.number));
      }
      // The count/temporal detectors no longer DRIVE anything — both are shadow-logged for
      // comparison against the ClearTracker-driven alerts above.
      for (const [name, evs] of [
        ["count", obs.countEvents],
        ["temporal", obs.temporalEvents],
      ] as const) {
        for (const event of evs) {
          logger.info(`${lane.label} ${name}(detector): would ${event.kind} — ${event.cohort.label} peak ${event.cohort.peak}`);
        }
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
          const forming = await broadcasts.last(city, "raid-forming");
          const buffDropAt = (await buffStore.current(city))?.appliedAt ?? null;
          if (!shouldBroadcast(forming, buffDropAt, now, config.broadcastDedupMs)) notified.push(city);
        }
        if (notified.length === 0) return; // forming never alerted this cycle — nobody was told to park
        const line = formatRaidDisbandedWhisper(clear.number, notified, clear.durationMs);
        for (const city of notified) {
          whisperPool.dropForFaction(city);
          whisperQueue?.dropForFaction(city);
          yellSink[city]?.(line);
        }
        void push(formatRaidDisbanded(clear.number, notified, clear.durationMs), notified);
        if (config.whispersEnabled) {
          try {
            const subs = (await store.all()).filter((s) => notified.some((c) => s.factions.includes(c)));
            if (subs.length > 0) broadcastWhisper(subs.map((s) => s.name), line, notified[0] ?? null, notified, config.whisperMaxAgeMs);
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

      if (obs.clear) {
        await handleConfirmedClear(obs.clear, false);
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
            const drop = await buffStore.current(faction);
            const sinceLastDropMs = drop ? now - drop.appliedAt.getTime() : null;
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

    const processRoster = async (roster: Roster): Promise<void> => {
      const now = Date.now();
      const inZone = roster.players.filter((player) => player.areaId === config.watchAreaId);
      const complete = roster.complete;
      logger.info(
        `who ${config.watchAreaName}: ${inZone.length} in zone ` +
          `(${roster.players.length} returned, ${roster.onlineCount} online)` +
          (roster.sliced ? ` [class-sliced, complete=${complete}${roster.failedSlices > 0 ? `, ${roster.failedSlices} slices timed out` : ""}]` : ""),
      );

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

    const onWhisper = (sender: string, text: string): void => {
      logger.info(`whisper from ${sender}: ${JSON.stringify(text)}`);
      void (async () => {
        try {
          const replies = await router.handle(sender, text);
          for (const reply of replies) whisperQueue?.enqueue(sender, reply);
        } catch (error) {
          logger.error(`command from ${sender}: ${describeError(error)}`);
        }
      })();
    };

    // One /who at a time on this socket: the poll (sliced into several) and the subscribe
    // faction lookups all queue here so they never collide (world.whoOnce allows one).
    let whoChain: Promise<unknown> = Promise.resolve();
    const queuedWho = (query: WhoQuery): Promise<WhoResult> => {
      const run = (): Promise<WhoResult> => world.whoOnce(query, config.whoTimeoutMs);
      const result = whoChain.then(run, run);
      whoChain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };

    // Resolve a player's side with a targeted /who — they're online, having just whispered.
    // Null if it can't run, they're not found, or their race is custom. Used to tailor the
    // status to a non-subscriber's capital.
    const detectFaction = async (name: string): Promise<Faction | null> => {
      // Prefer a listener's socket so a /who never steals a slot from the raid poll — the
      // listeners don't run the 20s/60s census, so their /who chain is idle. Falls back to
      // Bufftracker's own /who only when no listener is in world.
      const who = listenerWho.any() ?? queuedWho;
      try {
        const result = await who({ minLevel: 0, maxLevel: 100, playerName: name });
        const player = result.players.find((p) => subscriberKey(p.name) === subscriberKey(name));
        return player ? factionOfRace(player.raceId) : null;
      } catch (error) {
        logger.debug(`faction lookup for ${name}: ${describeError(error)}`);
        return null;
      }
    };
    // Auto-set a new subscriber's side from the detected faction (leave "both" if unknown).
    const lookupFaction = async (name: string): Promise<void> => {
      const faction = await detectFaction(name);
      if (!faction) return; // offline, not found, or a custom race — leave them on "both"
      if (await store.update(name, { factions: [faction], factionSource: "auto" })) {
        logger.info(`faction: detected ${name} as ${faction}`);
      }
    };

    // Actively clear the both-faction backlog: each tick, /who ONE subscriber still on the
    // unresolved "both" default and set their side — so they get the right city's alerts WITHOUT
    // ever whispering us. Runs through a LISTENER's /who (idle chain, so it never competes with or
    // delays the raid poll), slowly, as a low-priority background cleanup. Covers future stragglers
    // too: a failed /who at subscribe, or a direct-to-Bufftracker whisper (no listener to infer
    // from), lands back on the both-default and is picked up on the next re-scan. Offline /
    // custom-race lookups return nothing and are retried on a later pass.
    let resolveQueue: string[] = [];
    let nextResolveRescanAt = 0;
    const resolveNextFaction = async (now: number): Promise<void> => {
      if (resolveQueue.length === 0) {
        if (now < nextResolveRescanAt) return; // backlog was empty recently — don't re-scan every tick
        const subs = await store.all().catch(() => []);
        resolveQueue = subs.filter(needsFactionResolution).map((s) => s.name);
        if (resolveQueue.length === 0) {
          nextResolveRescanAt = now + FACTION_RESOLVE_IDLE_RESCAN_MS;
          return;
        }
        logger.info(`faction: resolving ${resolveQueue.length} both-faction subscriber(s) in the background`);
      }
      const name = resolveQueue.shift();
      if (name) await lookupFaction(name); // via a listener's /who — never competes with the raid poll
    };

    // Guild invites the bot sends, so a matching JOIN can be welcomed in guild chat. An invite not
    // accepted within the TTL is stale (the popup lapsed), so we don't welcome on a late/unrelated join.
    const GUILD_INVITE_TTL_MS = 10 * 60_000;
    const pendingGuildInvites = new Map<string, number>();
    const guildInvite = (nameTo: string): void => {
      pendingGuildInvites.set(nameTo.toLowerCase(), Date.now());
      world.guildInvite(nameTo);
      void inviteLedger.record(nameTo).catch((error) => logger.debug(`invites: record failed (${describeError(error)})`));
    };
    const welcomeIfWeInvited = (name: string): void => {
      const invitedAt = pendingGuildInvites.get(name.toLowerCase());
      if (invitedAt === undefined) return; // joined via someone else's invite — not ours to greet
      pendingGuildInvites.delete(name.toLowerCase());
      if (Date.now() - invitedAt > GUILD_INVITE_TTL_MS) return; // accepted too late to be sure it's ours
      logger.info(`guild: ${name} accepted our invite — welcoming in /g`);
      world.guildChat(formatGuildWelcome(name));
      // Count them among the active bot-invited guild members (removed if they later leave).
      void guildieStore.add(name).catch((error) => logger.debug(`guildies: add failed (${describeError(error)})`));
    };
    // A member left / was removed from the guild — if they were one of ours, drop the count.
    const onGuildLeave = (name: string): void => {
      void guildieStore
        .remove(name)
        .then((removed) => {
          if (removed) logger.info(`guild: ${name} left — was bot-invited, removed from the active count`);
        })
        .catch((error) => logger.debug(`guildies: remove failed (${describeError(error)})`));
    };

    let lftSeen = 0; // LFT channel messages seen, for the observe heartbeat
    const headIncomingSeen = new Map<string, number>(); // faction+witness -> last alert time, for dedup
    const world = new WorldClient({
      socket,
      account: config.account,
      sessionKey,
      characterName: config.characterName,
      build: client.worldBuild,
      logger,
      handlers: {
        onReady: () => {
          if (readyTimer) clearTimeout(readyTimer);
          readyTimer = null;
          logger.info(
            `in world; watching ${config.watchAreaName} about every ${config.pollIntervalMs / 1000}s`,
          );
          onConnected(); // realm-recovery signal fires on reconnect, not on the next close

          // Offer Bufftracker's outbound channel so listeners can greet players through it,
          // and give the command router the guild-invite capability for the "invite" command.
          if (config.whispersEnabled) {
            outreach.setChannel((nameTo, msg) => whisperQueue?.enqueue(nameTo, msg), guildInvite);
            router.setGuildInvite(guildInvite);
            // The watcher can now whisper, so route listener-heard buff drops through it.
            buffDropSink.notify = (faction, _appliedAt, savedHead) =>
              void announceBuffDrop(faction, savedHead).catch((error) =>
                logger.error(`buff-drop announce: ${describeError(error)}`),
              );
          }
          router.setFactionLookup((name) => void lookupFaction(name));
          router.setFactionDetect(detectFaction);
          // Read Turtle's LFT addon-comms channel for world-buff broadcasts (flag-gated, observe
          // only). Bufftracker is the single reader, so there is no cross-listener dedup to do.
          if (config.lftChannel) {
            try {
              world.joinChannel(config.lftChannel);
            } catch (error) {
              logger.warn(`could not join channel ${config.lftChannel}: ${describeError(error)}`);
            }
          }
          // One-off live check of the presence sweep (route B): sweep every subscriber once and log
          // the split, no whisper. Proves the add→read→remove pipeline against the real server before
          // the gate is enabled. Delayed so the subscriber store and the connection have settled.
          const probeSweeper = presenceSweeper;
          if (config.presenceProbe && probeSweeper) {
            const probeTimer = setTimeout(() => {
              if (settled) return;
              void (async () => {
                const names = (await store.all().catch(() => [])).map((s) => s.name);
                logger.info(`PRESENCE-PROBE: sweeping ${names.length} subscriber(s) — no whisper`);
                const startedAt = Date.now();
                const keep = await probeSweeper.sweep(names);
                logger.info(
                  `PRESENCE-PROBE: done in ${Date.now() - startedAt}ms — kept ${keep.size} (online/unknown), dropped ${names.length - keep.size} confirmed offline`,
                );
              })().catch((error) => logger.error(`presence-probe: ${describeError(error)}`));
            }, 15_000);
            probeTimer.unref?.();
          }
          const poll = async (): Promise<void> => {
            try {
              // Spread the class slices across the idle listener sockets too, not just this one.
              const roster = await fetchRoster(queuedWho, listenerWho.all(), config.watchAreaId, config.whoSliceDelayMs);
              if (!settled) await processRoster(roster);
            } catch (error) {
              logger.warn(`who failed: ${describeError(error)}`);
            }
            if (settled) return;
            pollTimer = setTimeout(() => void poll(), jitter(config.pollIntervalMs, POLL_JITTER_RATIO));
            pollTimer.unref?.();
          };
          void poll();
          // Yell a buff-status board in the capitals on a slow cadence.
          statusYellTimer = setInterval(() => {
            if (!settled) void yellCapitalStatus().catch((e) => logger.debug(`status yell: ${describeError(e)}`));
          }, config.statusYellMs);
          statusYellTimer.unref?.();
          // Actively resolve the both-faction backlog in the background, one /who at a time.
          factionResolveTimer = setInterval(() => {
            if (!settled) void resolveNextFaction(Date.now()).catch((e) => logger.debug(`faction resolve: ${describeError(e)}`));
          }, FACTION_RESOLVE_MS);
          factionResolveTimer.unref?.();
        },
        // PHASE 1 (staged): an OB_INC on LFT is an ADVANCE warning that an Onyxia head is being
        // turned in NOW — before the yell. Fire it, but to the OPS (errors) channel for now, not the
        // public buff channel, while the source addon has few users. Deduped per turn-in (the channel
        // retransmits the same OB_INC many times). LFT is otherwise a firehose we don't log.
        onChannelMessage: (channelName, _senderGuid, text, raw) => {
          lftSeen += 1;
          const runs = printableAsciiRuns(raw);
          const obLine = [text, ...runs].find((s) => s.startsWith("OB_INC:") || s.startsWith("OB:"));
          const incoming = parseHeadIncoming(obLine ?? "");
          if (incoming && isOnyxiaHead(incoming.boss)) {
            const now = Date.now();
            for (const [k, t] of headIncomingSeen) if (now - t > HEAD_INCOMING_DEDUP_MS) headIncomingSeen.delete(k);
            const key = `${incoming.faction}-${incoming.witness}`;
            if (now - (headIncomingSeen.get(key) ?? 0) > HEAD_INCOMING_DEDUP_MS) {
              headIncomingSeen.set(key, now);
              const msg = formatHeadIncoming(incoming.faction, incoming.witness);
              logger.info(`LFT head-incoming -> tests: ${incoming.faction} witness=${incoming.witness} at ${incoming.serverHour}:${String(incoming.serverMinute).padStart(2, "0")}`);
              void notifyTests(msg.title, msg.body).catch((e) => logger.error(`head-incoming notify: ${describeError(e)}`));
            }
          } else if (obLine) {
            logger.info(`LFT OB message (unparsed/non-onyxia): ${JSON.stringify(obLine)} on ${JSON.stringify(channelName)}`);
          } else if (lftSeen % 200 === 0) {
            logger.info(`LFT: ${lftSeen} messages seen (sample runs ${JSON.stringify(runs.slice(0, 3))})`);
          }
        },
        onWhisper: config.whispersEnabled ? onWhisper : undefined,
        // Friend-op replies feed the presence sweep (route B). Only the watcher sweeps, so only its
        // client wires these; the listeners leave them unset.
        onFriendStatus: (status) => presenceSweeper?.handleFriendStatus(status),
        onFriendList: (list) => presenceSweeper?.handleFriendList(list),
        // A player joined the guild — if we invited them, welcome them in /g (no whisper).
        onGuildJoin: (name) => welcomeIfWeInvited(name),
        onGuildLeave: (name) => onGuildLeave(name),
        // Server SYSTEM messages report command results. Log every one (so real error wording can
        // be captured and added to the classifier), and alert the errors channel on a failure —
        // chiefly a guild invite that didn't take (no permission, target already guilded, etc.).
        onSystemMessage: (text) => {
          if (!text) return;
          logger.info(`system: ${JSON.stringify(text)}`);
          // Whisper spam-throttle: back the queue off and retry the dropped whispers rather than
          // alert — it's self-healing and fires in bursts, so alerting would just be noise.
          if (isWhisperThrottle(text)) {
            whisperQueue?.notifyThrottled();
            return;
          }
          if (isCommandError(text)) {
            void notifyAdmin("⚠️ Command failed in-game", text).catch((e) =>
              logger.debug(`system-error notify: ${describeError(e)}`),
            );
          }
        },
        onError: (error) => {
          world.close();
          settle(error);
        },
        onClose: () => settle(new Error("world connection closed")),
      },
    });
    // The watcher's world client IS a FriendOps (add/del/requestFriendList) — hand it to the sweep
    // so a broadcast can learn who is online. Created now; consulted only once in-world. Also created
    // for the boot probe, so the pipeline can be checked live before the gate is turned on.
    if (config.presenceEnabled || config.presenceProbe) {
      // Generous deadline: the sweep is a per-name realm round-trip (~one name every few hundred ms)
      // but STREAMS and runs in the background, far ahead of the throttled whisper drain, so it can
      // cover the whole roster. The deadline is only a safety cap — its remainder fails open.
      presenceSweeper = new PresenceSweeper({ ops: world, logger, sweepDeadlineMs: 240_000 });
    }
    // State the presence gate's runtime state on every watcher connect — a broadcast either logs a
    // "presence:" sweep line or it doesn't, and this says which is expected.
    logger.info(
      `presence gate: ${config.presenceEnabled ? "ENABLED" : "off"}${config.presenceProbe ? " + probe" : ""}`,
    );

    whisperQueue = new WhisperQueue(
      (targetName, message) => world.whisper(targetName, message),
      config.whisperThrottleMs,
      (error, targetName) => logger.debug(`whisper to ${targetName} failed: ${describeError(error)}`),
      (line) => logger.info(`whisper-meter [Bufftracker]: ${line}`),
    );

    world.start();

    // If we don't reach in-world within the window, the handshake stalled — tear it
    // down and let the supervisor reconnect rather than hanging here forever.
    readyTimer = setTimeout(() => {
      world.close();
      settle(new Error("timed out reaching world (handshake stalled)"));
    }, WORLD_READY_TIMEOUT_MS);
    readyTimer.unref?.();
  });
}

/**
 * A listener session: log in a city-parked character, reach the world, and forward buff yells.
 * It also lends its socket for faction /who lookups and joins the whisper pool (so broadcasts
 * fan across the listeners' throttle budgets). Shares the client identity so a patch heals once.
 */
async function runListener(
  config: BotConfig,
  listener: ListenerConfig,
  logger: Logger,
  client: ClientValues,
  onBuffApplied: (faction: Faction, sourceName: string, text: string) => void,
  outreach: Outreach,
  yellSink: YellSink,
  listenerWho: ListenerWho,
  whisperPool: WhisperPool,
  // Fired once this listener reaches in-world — the realm-recovery signal (see runConnection).
  onConnected: () => void,
): Promise<void> {
  const { sessionKey, realms } = await new AuthClient(logger).login({
    host: config.authHost,
    port: config.authPort,
    username: listener.account,
    password: listener.password,
    integrityChecksum: client.integrityChecksum,
    build: client.build,
  });

  const target = resolveWorldTarget(config, realms, logger);
  const socket = await connectSocket(target.host, target.port);

  await new Promise<void>((resolve, reject) => {
    let readyTimer: NodeJS.Timeout | null = null;
    let interactTimer: NodeJS.Timeout | null = null;
    let settled = false;
    // "interact": accumulate the login object burst, then use the closest GameObject.
    const nearby: WorldGameObject[] = [];
    let selfPos: WorldPoint | null = null;
    let interacted = false;
    // Our /yell mouthpiece registration, so we only retract it on disconnect if it's still
    // ours (a reconnect may have already replaced it with the new connection's).
    let registeredYell: ((message: string) => void) | null = null;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (readyTimer) clearTimeout(readyTimer);
      if (interactTimer) clearTimeout(interactTimer);
      listenerWho.unregister(listener.characterName); // stop offering this socket once it's gone
      whisperPool.unregister(listener.characterName); // and stop routing broadcasts through it
      listenerWhispers.stop();
      if (listener.faction && registeredYell && yellSink[listener.faction] === registeredYell) {
        delete yellSink[listener.faction];
      }
      if (error) reject(error);
      else resolve();
    };

    // A one-at-a-time /who on THIS listener's socket, offered to Bufftracker for faction lookups
    // so they don't queue behind its raid poll. Idle otherwise — a listener never polls.
    let whoChain: Promise<unknown> = Promise.resolve();
    const queuedWho = (query: WhoQuery): Promise<WhoResult> => {
      const run = (): Promise<WhoResult> => world.whoOnce(query, config.whoTimeoutMs);
      const result = whoChain.then(run, run);
      whoChain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };

    // This listener's own whisper queue, wired to its socket. Registered in the pool while in
    // world, so a broadcast to many subscribers fans across the listeners' separate throttle
    // budgets (cross-faction whisper works here, so either listener can reach any subscriber).
    const listenerWhispers = new WhisperQueue(
      (targetName, message) => world.whisper(targetName, message),
      config.whisperThrottleMs,
      (error, targetName) => logger.debug(`whisper to ${targetName} failed: ${describeError(error)}`),
      (line) => logger.info(`whisper-meter [${listener.characterName}]: ${line}`),
    );

    const world = new WorldClient({
      socket,
      account: listener.account,
      sessionKey,
      characterName: listener.characterName,
      build: client.worldBuild,
      logger,
      handlers: {
        onReady: () => {
          if (readyTimer) clearTimeout(readyTimer);
          readyTimer = null;
          logger.info(`in world as ${listener.characterName}; listening for buff yells`);
          onConnected(); // realm-recovery signal fires on reconnect, not on the next close
          // Offer this socket for Bufftracker's faction lookups, keeping them off its raid poll.
          listenerWho.register(listener.characterName, queuedWho);
          // Join the whisper pool so broadcasts can fan across this listener's own throttle budget.
          whisperPool.register(listener.characterName, listener.faction, listenerWhispers);
          // Become this side's /yell mouthpiece, so a park-alert can be shouted to everyone
          // standing in this capital. Only when the listener's faction is configured.
          if (listener.faction) {
            registeredYell = (message: string): void => world.yell(message);
            yellSink[listener.faction] = registeredYell;
            logger.info(`${listener.characterName}: registered as ${listener.faction} yell mouthpiece`);
          }
          if (listener.onLogin === "sit") world.sit();
          else if (listener.onLogin === "interact") {
            // The object burst trickles in over several seconds, so we WAIT for it to settle
            // (accumulate the whole window) before picking, then `use` the target and dump the
            // full list. With WOW_INTERACT_ENTRY set we only consider that entry (the bench),
            // ignoring clutter; otherwise the nearest. Dumping everything is how the bench's
            // real entry is found when it isn't simply the closest object.
            let attempts = 0;
            const distTo = (go: WorldGameObject): number =>
              selfPos ? Math.hypot(go.pos.x - selfPos.x, go.pos.y - selfPos.y, go.pos.z - selfPos.z) : Infinity;
            const fullList = (): string =>
              [...nearby]
                .sort((a, b) => distTo(a) - distTo(b))
                .slice(0, 20)
                .map((go) => `${go.entry}@${distTo(go).toFixed(1)}`)
                .join(", ");
            const tryInteract = (): void => {
              attempts += 1;
              if (attempts < OBJECT_POLL_MAX) {
                // Still gathering the object burst — wait so we pick from the full set.
                interactTimer = setTimeout(tryInteract, OBJECT_POLL_MS);
                interactTimer.unref?.();
                return;
              }
              interacted = true;
              const sp = selfPos;
              const pool =
                config.interactEntry !== null ? nearby.filter((go) => go.entry === config.interactEntry) : nearby;
              const target = sp ? nearestGameObject(pool, sp) : null;
              const dist = target ? distTo(target) : Infinity;
              logger.info(
                `${listener.characterName}: interact settled — ` +
                  `self=${sp ? `(${sp.x.toFixed(0)},${sp.y.toFixed(0)},${sp.z.toFixed(0)})` : "no"}, ` +
                  `objects=${nearby.length}, all=[${fullList()}]`,
              );
              if (target && dist <= config.interactMaxYd) {
                logger.info(
                  `${listener.characterName}: using entry=${target.entry} (~${dist.toFixed(1)} yd)` +
                    `${config.interactEntry !== null ? " [targeted]" : ""} — check in-game if seated`,
                );
                world.useGameObject(target.guid);
              } else {
                logger.warn(
                  `${listener.characterName}: no ${config.interactEntry !== null ? `entry-${config.interactEntry} ` : ""}` +
                    `object within ${config.interactMaxYd}yd`,
                );
              }
            };
            interactTimer = setTimeout(tryInteract, OBJECT_POLL_MS);
            interactTimer.unref?.();
          }
        },
        onMonsterYell: (senderName, text) => {
          const faction = matchBuffYell(text);
          // Log EVERY yell heard so a real buff yell that doesn't match the pattern is
          // visible rather than silently dropped. buff-yell.test.ts proves the matcher
          // against the EXPECTED string; only a real yell validates it against the
          // ACTUAL server text. Also confirms the listener receives MonsterYell at all.
          logger.info(`heard yell from ${senderName}: ${JSON.stringify(text)}${faction ? ` -> BUFF ${faction}` : ""}`);
          if (faction) onBuffApplied(faction, senderName, text);
        },
        // A player whispered this parked character → transfer it to Bufftracker, which
        // answers (and introduces itself on the player's first contact). The listener is
        // just the ear; Bufftracker does the thinking and the whispering back.
        onWhisper: (sender, text) => {
          logger.info(`whisper from ${sender}: ${JSON.stringify(text)} -> routed to ${config.characterName}`);
          // The listener serves one faction's capital, so its whisperer is that faction in
          // practice (safe to assume even on a cross-faction realm) — pass it as a faction hint so
          // the command engine skips the faction /who.
          void outreach
            .onListenerContact(sender, text, listener.faction)
            .catch((error) => logger.error(`outreach: ${describeError(error)}`));
        },
        onSystemMessage: (text) => {
          // This listener whispers too now, so the server can throttle it — back its own queue off
          // and retry, exactly as Bufftracker does.
          if (text && isWhisperThrottle(text)) listenerWhispers.notifyThrottled();
        },
        onWorldObjects:
          listener.onLogin === "interact"
            ? (raw) => {
                if (interacted) return;
                // parseUpdateObject returns partial results (never throws) on a shape
                // it can't decode, so we keep whatever GameObjects it read. Pass our own
                // GUID so `self` is OUR position, never a bystander's in the same packet.
                const parsed = parseUpdateObject(raw, world.selfGuid ?? undefined);
                for (const go of parsed.gameObjects) nearby.push(go);
                if (parsed.self) selfPos = parsed.self;
              }
            : undefined,
        onError: (error) => {
          world.close();
          settle(error);
        },
        onClose: () => settle(new Error("listener connection closed")),
      },
    });

    world.start();
    // Same handshake-stall guard as the watcher: bound the time to reach in-world.
    readyTimer = setTimeout(() => {
      world.close();
      settle(new Error("timed out reaching world (handshake stalled)"));
    }, WORLD_READY_TIMEOUT_MS);
    readyTimer.unref?.();
  });
}

/** Open the subscriber store — Mongo when configured, else in-memory. */
async function openStore(
  config: BotConfig,
  logger: Logger,
  notifyAdmin: (title: string, body: string) => Promise<void>,
): Promise<SubscriberStore> {
  if (!config.mongodbUri) {
    logger.warn("subscribers: no MONGODB_URI — keeping subscribers in memory (lost on restart)");
    return new InMemorySubscriberStore();
  }
  try {
    const store = await MongoSubscriberStore.connect(config.mongodbUri, config.mongodbDb);
    logger.info(`subscribers: connected to MongoDB db "${config.mongodbDb}"`);
    return store;
  } catch (error) {
    logger.error(`subscribers: MongoDB connect failed (${describeError(error)}); using memory`);
    await notifyAdmin(
      "⚠️ Subscriber store offline",
      "MongoDB is unreachable — in-game subscriptions are in memory until restart.",
    );
    return new InMemorySubscriberStore();
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file; rely on the ambient environment.
  }

  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);

  // Dev toggle: stay logged out so the character is free to play. Nothing
  // game-related starts — we just idle so Railway holds the container rather than
  // restart-looping. Flip WOW_LOGIN_ENABLED back to true (or remove it) to reconnect.
  if (!config.loginEnabled) {
    logger.warn(
      `login disabled (WOW_LOGIN_ENABLED=false): not connecting ${config.characterName} — ` +
        "the character is free for you to play. Set WOW_LOGIN_ENABLED=true and redeploy to bring the bot back.",
    );
    setInterval(
      () => logger.info(`idle — login disabled; ${config.characterName} is free to play`),
      10 * 60 * 1000,
    );
    return;
  }


  // Monotonic raid reference number (#834) — persisted so it climbs across restarts. Seeded
  // once, bumped in memory when a raid forms, saved as it goes.
  let raidCounterStore: RaidCounterStore = new InMemoryRaidCounterStore();
  if (config.mongodbUri) {
    try {
      raidCounterStore = await MongoRaidCounterStore.connect(config.mongodbUri, config.mongodbDb);
    } catch (error) {
      logger.error(`raid counter: MongoDB connect failed (${describeError(error)}); numbering in memory`);
    }
  }
  let raidCounter = await raidCounterStore.load();
  const nextRaidNumber = (): number => {
    raidCounter += 1;
    void raidCounterStore.save(raidCounter).catch((error) => logger.debug(`raid counter save: ${describeError(error)}`));
    return raidCounter;
  };

  // The raid in progress per lane — persisted so a restart RESUMES it (keeps its number,
  // form time and roster) instead of orphaning it and missing the exit alert/recap.
  let raidStateStore: RaidStateStore = new InMemoryRaidStateStore();
  if (config.mongodbUri) {
    try {
      raidStateStore = await MongoRaidStateStore.connect(config.mongodbUri, config.mongodbDb);
    } catch (error) {
      logger.error(`raid state: MongoDB connect failed (${describeError(error)}); not resuming across restarts`);
    }
  }

  const watchOptions: RaidWatchOptions = {
    minRaidSize: config.minRaidSize,
    grouping: config.raidGrouping,
    clearSize: config.raidClearSize,
    strengthSize: config.raidStrengthSize,
    leftFloor: config.raidLeftFloor,
    clearSustainedMs: config.raidClearSustainedMs,
    fillWindowMs: config.raidFillWindowMs,
    rosterCap: config.raidRosterCap,
    nextRaidNumber,
  };
  const lanes: DetectionLane[] =
    config.realmType === "faction"
      ? [
          { label: "alliance", watch: new RaidWatch(watchOptions), cities: ["alliance"], players: (s) => s.alliance },
          { label: "horde", watch: new RaidWatch(watchOptions), cities: ["horde"], players: (s) => s.horde },
        ]
      : [
          {
            label: "lair",
            watch: new RaidWatch(watchOptions),
            cities: ["alliance", "horde"],
            players: (s) => [...s.alliance, ...s.horde, ...s.unknown],
          },
        ];

  // Resume any raid that was in progress when we last stopped, so its exit is still caught.
  for (const lane of lanes) {
    const state = await raidStateStore.load(lane.label);
    if (state) {
      lane.watch.restoreRaidState(state);
      logger.info(`resumed raid #${state.number ?? "?"} on lane ${lane.label} (${state.roster.length} members, from before restart)`);
    }
  }

  // Client identity values; re-resolved from the CDN if the server rejects them.
  const client: ClientValues = {
    build: config.build,
    worldBuild: config.worldBuild,
    integrityChecksum: config.integrityChecksum,
  };

  // The bot posts to a single Onyxia notification channel (no DMs, no webhook). Faction alerts
  // ping @alliance / @horde — a Discord-side opt-in, unrelated to any in-game character's side.
  const dm = new DiscordDmSender(config.discordBotToken);
  const push = async (message: NotifyMessage, factions: readonly Faction[] = []): Promise<void> => {
    if (!config.discordOnyxiaChannelId) {
      logger.debug(`onyxia notify (no channel set): ${message.title}`);
      return;
    }
    const roleIds = factions
      .map((faction) => (faction === "alliance" ? config.discordAllianceRoleId : config.discordHordeRoleId))
      .filter((id): id is string => id !== null);
    const mention = roleIds.map((id) => `<@&${id}>`).join(" ");
    const content = `${mention ? mention + " " : ""}**${message.title}**\n${message.body}`;
    const result = await dm.postToChannel(config.discordOnyxiaChannelId, content, roleIds);
    if (!result.ok) logger.error(`onyxia notify failed (${result.kind}): ${message.title}`);
  };
  // Operational/error notices (auth failures, store outages, self-heal, "bot stopped") — always
  // logged, and posted to the dedicated errors channel when one is configured. Never DMed, and
  // never to the public buff channel (which is for buff content, not error spam).
  const notifyAdmin = async (title: string, body: string): Promise<void> => {
    logger.warn(`[ops] ${title} - ${body}`);
    if (!config.discordErrorsChannelId) return;
    const result = await dm.postToChannel(config.discordErrorsChannelId, `**${title}**\n${body}`);
    if (!result.ok) logger.error(`ops notify failed (${result.kind}): ${title}`);
  };
  // Staged/test alerts (features being validated before the public buff channel). Posts to the
  // dedicated tests channel, falling back to the errors channel if none is set.
  const notifyTests = async (title: string, body: string): Promise<void> => {
    const channel = config.discordTestsChannelId ?? config.discordErrorsChannelId;
    logger.info(`[test] ${title} - ${body}`);
    if (!channel) return;
    const result = await dm.postToChannel(channel, `**${title}**\n${body}`);
    if (!result.ok) logger.error(`test notify failed (${result.kind}): ${title}`);
  };

  const store = config.whispersEnabled
    ? await openStore(config, logger, notifyAdmin)
    : new InMemorySubscriberStore();

  // Raw /who snapshots for offline replay/stats — Mongo when configured, else memory.
  let snapshots: SnapshotStore = new InMemorySnapshotStore();
  if (config.mongodbUri) {
    try {
      snapshots = await MongoSnapshotStore.connect(config.mongodbUri, config.mongodbDb);
      logger.info("snapshots: recording /who history to MongoDB");
    } catch (error) {
      logger.error(`snapshots: MongoDB connect failed (${describeError(error)}); recording in memory`);
    }
  }

  // Buff-drop times per faction, fed by the city listeners — Mongo when configured.
  let buffStore: BuffStore = new InMemoryBuffStore();
  if (config.mongodbUri) {
    try {
      buffStore = await MongoBuffStore.connect(config.mongodbUri, config.mongodbDb);
      logger.info("buffs: recording drop times to MongoDB");
    } catch (error) {
      logger.error(`buffs: MongoDB connect failed (${describeError(error)}); recording in memory`);
    }
  }
  // Per-cycle park-alert dedup, so a redeploy/wipe/churn can't re-broadcast — Mongo when
  // configured, else in memory (which resets on restart, i.e. no cross-deploy dedup).
  let broadcasts: BroadcastLedger = new InMemoryBroadcastLedger();
  if (config.mongodbUri) {
    try {
      broadcasts = await MongoBroadcastLedger.connect(config.mongodbUri, config.mongodbDb);
      logger.info("broadcasts: recording park-alert times to MongoDB");
    } catch (error) {
      logger.error(`broadcasts: MongoDB connect failed (${describeError(error)}); deduping in memory`);
    }
  }
  // Learned raid clear-times for the self-improving forming heads-up.
  let durationStore: DurationStore = new InMemoryDurationStore();
  if (config.mongodbUri) {
    try {
      durationStore = await MongoDurationStore.connect(config.mongodbUri, config.mongodbDb);
      logger.info("durations: recording raid clear-times to MongoDB");
    } catch (error) {
      logger.error(`durations: MongoDB connect failed (${describeError(error)}); recording in memory`);
    }
  }
  // Player-submitted feedback/suggestions — kept for review, posted to the feedback channel.
  let feedbackStore: FeedbackStore = new InMemoryFeedbackStore();
  if (config.mongodbUri) {
    try {
      feedbackStore = await MongoFeedbackStore.connect(config.mongodbUri, config.mongodbDb);
      logger.info("feedback: recording player suggestions to MongoDB");
    } catch (error) {
      logger.error(`feedback: MongoDB connect failed (${describeError(error)}); recording in memory`);
    }
  }
  // Who Bufftracker has already introduced itself to, so the intro + auto-invite fire once per
  // player rather than every whisper. In memory without Mongo (re-introduces after a redeploy).
  let introStore: IntroStore = new InMemoryIntroStore();
  if (config.mongodbUri) {
    try {
      introStore = await MongoIntroStore.connect(config.mongodbUri, config.mongodbDb);
      logger.info("intros: remembering greeted players in MongoDB");
    } catch (error) {
      logger.error(`intros: MongoDB connect failed (${describeError(error)}); remembering in memory`);
    }
  }
  // Lifetime user count for statistics: every distinct player who has ever subscribed, kept even
  // after they unsubscribe (the subscriber store drops the active row; this ledger never does).
  let userLedger: UserLedger = new InMemoryUserLedger();
  if (config.mongodbUri) {
    try {
      userLedger = await MongoUserLedger.connect(config.mongodbUri, config.mongodbDb);
      logger.info("users: counting lifetime subscribers in MongoDB");
    } catch (error) {
      logger.error(`users: MongoDB connect failed (${describeError(error)}); counting in memory`);
    }
  }
  // Seed the ledger with anyone already subscribed (they predate it) so the total is right from
  // the first boot. Idempotent, and fire-and-forget so it never delays startup.
  void store
    .all()
    .then((subs) => Promise.all(subs.map((s) => userLedger.record(s.name))))
    .catch((error) => logger.debug(`users: seed failed (${describeError(error)})`));

  // Lifetime count of distinct players we've guild-invited — the same shape as the user ledger,
  // in its own `invites` collection.
  let inviteLedger: UserLedger = new InMemoryUserLedger();
  if (config.mongodbUri) {
    try {
      inviteLedger = await MongoUserLedger.connect(config.mongodbUri, config.mongodbDb, "invites");
      logger.info("invites: counting lifetime guild invites in MongoDB");
    } catch (error) {
      logger.error(`invites: MongoDB connect failed (${describeError(error)}); counting in memory`);
    }
  }
  // Players CURRENTLY in the guild who joined via our invite — the "active subscribers" equivalent.
  // Rises on an invited join, falls on a guild leave.
  let guildieStore: GuildieStore = new InMemoryGuildieStore();
  if (config.mongodbUri) {
    try {
      guildieStore = await MongoGuildieStore.connect(config.mongodbUri, config.mongodbDb);
      logger.info("guildies: tracking active bot-invited guild members in MongoDB");
    } catch (error) {
      logger.error(`guildies: MongoDB connect failed (${describeError(error)}); tracking in memory`);
    }
  }

  // Chronicle early-confirm: during a departure WE detect, a fresh kill log by one of the raid's
  // roster confirms the clear and lets processLane skip the sustained wait (never a trigger on its
  // own). Needs Mongo for the dedup ledger, so it's skipped without it. ±30 min around a kill's
  // pull keeps a roster member's kill from an EARLIER raid out of the match.
  const CHRONICLE_MATCH_WINDOW_MS = 30 * 60_000;
  let chronicleStore: ChronicleStore | null = null;
  let chronicle: LaneChronicle | null = null;
  if (config.chronicleEnabled && config.mongodbUri) {
    try {
      chronicleStore = await MongoChronicleStore.connect(config.mongodbUri, config.mongodbDb);
      chronicle = {
        client: new HttpChronicleClient(),
        store: chronicleStore,
        realm: config.realm,
        matchWindowMs: CHRONICLE_MATCH_WINDOW_MS,
      };
      logger.info(`chronicle: early-confirm armed for ${config.realm} (kill-confirms a detected clear)`);
    } catch (error) {
      logger.error(`chronicle: MongoDB connect failed (${describeError(error)}); early-confirm off`);
    }
  } else if (config.chronicleEnabled) {
    logger.info("chronicle: early-confirm needs MONGODB_URI — off");
  }

  // The watcher fills this once in world, so a listener-heard buff drop can be whispered.
  const buffDropSink: BuffDropSink = { notify: null };
  // The watcher stamps this each /who poll; recordBuff (on a listener) reads it to classify a drop.
  const lairActivity = newLairActivity();
  // Each city listener registers its /yell here on login (and clears it on disconnect), so
  // an alert can be shouted to everyone standing in that capital, not only to subscribers.
  const yellSink: YellSink = {};
  // Listener sockets Bufftracker borrows for faction /who, so lookups stay off its raid poll.
  const listenerWho = new ListenerWho();
  // The listeners' whisper queues, pooled so a broadcast to many subscribers splits across them
  // (each has its own server throttle budget). Bufftracker whispers through it, falling back to
  // its own queue only if no listener is in world.
  const whisperPool = new WhisperPool();

  const recordBuff = (faction: Faction, sourceName: string, text: string, detectedBy: string): void => {
    const appliedAt = new Date();
    // Fresh kill (a raid was in the lair), saved head (empty lair), or unknown (we were blind).
    // Only a confident "saved" adds a line to the post; fresh/unknown render exactly as before.
    const origin = classifyDropOrigin(appliedAt.getTime(), lairActivity, { freshWindowMs: config.raidFreshWindowMs });
    logger.info(`buff drop: ${faction} buff is up (${origin}) — ${detectedBy} heard "${text}" from ${sourceName}`);
    void buffStore
      .record({ faction, appliedAt })
      .catch((error) => logger.error(`buff-store: ${describeError(error)}`));
    // Announce it: the Discord channel post, and (via the watcher) that side's subscribers.
    void push(formatBuffDropped(faction, config.author, origin === "saved"), [faction]); // channel, pinging that side's role
    buffDropSink.notify?.(faction, appliedAt, origin === "saved");
  };

  // A player's feedback: persist it (for review) and post it to the feedback channel,
  // naming the sender. Best-effort — the player is always thanked regardless.
  const onFeedback = (from: string, text: string): void => {
    logger.info(`feedback from ${from}: ${JSON.stringify(text)}`);
    void feedbackStore
      .record({ from, text, at: new Date() })
      .catch((error) => logger.error(`feedback-store: ${describeError(error)}`));
    if (config.discordFeedbackChannelId) {
      void dm.postToChannel(config.discordFeedbackChannelId, formatFeedbackPost(from, text, config.realm)).then((result) => {
        if (!result.ok) logger.error(`feedback: couldn't post to channel (${result.kind}${result.status ? ` ${result.status}` : ""})`);
      });
    }
  };
  const router = new CommandRouter({
    store,
    activeRaids: () => lanes.flatMap((lane) => lane.watch.activeRaids()),
    raidElapsed: () => {
      const now = Date.now();
      const elapsed = lanes
        .map((lane) => lane.watch.raidElapsedMs(now))
        .filter((ms): ms is number => ms !== null);
      return elapsed.length > 0 ? Math.max(...elapsed) : null;
    },
    raidNumber: () => {
      for (const lane of lanes) {
        const n = lane.watch.raidNumber();
        if (n !== null) return n;
      }
      return null;
    },
    buffCooldowns: async () => {
      const nowMs = Date.now();
      return Promise.all(
        FACTIONS.map(async (faction) => {
          const drop = await buffStore.current(faction);
          return { faction, sinceLastDropMs: drop ? nowMs - drop.appliedAt.getTime() : null };
        }),
      );
    },
    areaName: config.watchAreaName,
    guildName: config.guildName,
    community: config.community,
    discordInvite: config.discordServerInvite,
    onFeedback,
    onSubscribe: (name) =>
      void userLedger.record(name).catch((error) => logger.debug(`users: record failed (${describeError(error)})`)),
  });
  const outreach = new Outreach(
    {
      guildName: config.guildName,
      guildRegion: config.guildRegion,
      community: config.community,
      guildInviteEnabled: config.guildInviteEnabled,
      author: config.author,
    },
    // Introduce Bufftracker to anyone who isn't a subscriber yet — once per player (introStore).
    (name) => store.has(name),
    introStore,
    logger,
  );
  // A whisper to a listener is transferred to Bufftracker's command engine and answered.
  outreach.setHandler((sender, text, sourceFaction) => router.handle(sender, text, sourceFaction));
  const services: ConnectionServices = {
    lanes,
    chronicle,
    listenerWho,
    whisperPool,
    buffStore,
    broadcasts,
    raidStateStore,
    durationStore,
    snapshots,
    store,
    userLedger,
    inviteLedger,
    guildieStore,
    router,
    dm,
    outreach,
    buffDropSink,
    lairActivity,
    yellSink,
    push,
    notifyAdmin,
    notifyTests,
    client,
  };

  logger.info(`turtle-onyxia-bot starting as ${config.characterName}`);
  if (config.announceStartup) {
    await push({
      kind: "info",
      title: `👁️ Watching ${config.watchAreaName}`,
      body: `Bot online as ${config.characterName}, polling every ${config.pollIntervalMs / 1000}s.`,
    });
  }

  let shuttingDown = false;
  // Railway (and most orchestrators) send SIGTERM on redeploy; without handling it the
  // old instance stays LOGGED IN until it's force-killed ~30s later, so for that window
  // two instances share the account — the "logs in twice" / duplicate-alert bug. Handle
  // both signals, stop reconnecting, and exit promptly (which closes the sockets = logout).
  let shutdownStarted = false;
  const shutdown = (signal: string): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    shuttingDown = true;
    logger.info(`shutting down (${signal})`);
    // Exit even if a store.close() hangs, so we log out fast and don't overlap a redeploy.
    const hardExit = setTimeout(() => process.exit(0), 3_000);
    hardExit.unref?.();
    void Promise.allSettled([
      store.close(),
      snapshots.close(),
      buffStore.close(),
      broadcasts.close(),
      durationStore.close(),
      feedbackStore.close(),
      introStore.close(),
      userLedger.close(),
      inviteLedger.close(),
      guildieStore.close(),
      raidCounterStore.close(),
      raidStateStore.close(),
      chronicleStore ? chronicleStore.close() : Promise.resolve(),
    ]).finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // The watcher does /who + alerts + whispers; each listener only forwards buff yells.
  // They run concurrently, each with its own self-reconnecting supervisor.
  //
  // Beyond the per-connection ops alerts each supervisor already sends, one shared monitor turns
  // ALL connections being sustained-down at once into a single realm-outage post for the community
  // channel — every character sits on the same realm, so a lone flaky one is not a realm outage but
  // all of them dropping together is. Fed each supervisor's already-latched down/recover transitions.
  const serverMonitor = new ServerMonitor([
    config.characterName,
    ...config.listeners.map((listener) => listener.characterName),
  ]);
  // "Back up" is CONFIRMED, not fired on the first reconnect: a recovery starts a stability timer and
  // only posts if the realm stays up for realmStableMs — so a flappy crash-recovery doesn't announce
  // recovery early. A full re-down cancels the pending timer.
  let realmRecoveryTimer: NodeJS.Timeout | null = null;
  const cancelRealmRecovery = (): void => {
    if (realmRecoveryTimer) clearTimeout(realmRecoveryTimer);
    realmRecoveryTimer = null;
  };
  const announceRealmDown = async (id: string): Promise<void> => {
    const announce = serverMonitor.connectionDown(id, Date.now());
    if (serverMonitor.isFullyDown()) cancelRealmRecovery(); // flapped fully down again — drop the pending "back up"
    if (announce) await push(formatServerDown(config.realm));
  };
  const announceRealmUp = (id: string): void => {
    const outageMs = serverMonitor.connectionUp(id, Date.now());
    if (outageMs === null) return; // not the start of a recovery window
    cancelRealmRecovery();
    realmRecoveryTimer = setTimeout(() => {
      realmRecoveryTimer = null;
      if (serverMonitor.confirmRecovery()) {
        void push(formatServerUp(config.realm, outageMs)).catch((error) =>
          logger.error(`realm-up notify: ${describeError(error)}`),
        );
      }
    }, config.realmStableMs);
    realmRecoveryTimer.unref?.();
  };

  const watcherLog = prefixed(logger, config.characterName);
  const runWatcher = async (): Promise<void> => {
    const heal: HealState = { lastCheckMs: 0, alertedStuck: false };
    const down = new DownTracker(DOWN_ALERT_THRESHOLD);
    let backoffMs = 5_000;
    while (!shuttingDown) {
      try {
        await runConnection(config, watcherLog, services, () => announceRealmUp(config.characterName));
        watcherLog.warn("connection closed; reconnecting shortly");
        backoffMs = 5_000;
        heal.alertedStuck = false; // a clean run clears the "stuck" latch
        if (down.recover()) await notifyAdmin("✅ Watcher back online", "Reconnected and watching again.");
      } catch (error) {
        if (error instanceof VersionMismatchError) {
          if (await selfHeal(error, config, logger, client, notifyAdmin, heal)) {
            backoffMs = 5_000; // resolved — retry promptly with the new build
          } else if (!config.autoResolve) {
            await notifyAdmin("🛑 Bot stopping", "Client version rejected and auto-resolve is off — can't self-heal.");
            process.exit(1); // can't self-heal and it's disabled: stop
          } else {
            await delay(backoffMs); // can't heal right now; back off and retry quietly
            backoffMs = Math.min(backoffMs * 2, 60_000);
          }
        } else if (error instanceof FatalError) {
          logger.error(error.message);
          await notifyAdmin("Bot stopped", error.message);
          process.exit(1);
        } else {
          watcherLog.warn(`connection error: ${describeError(error)}; retrying in ${backoffMs / 1000}s`);
          if (down.fail()) {
            await notifyAdmin(
              "⚠️ Watcher down",
              `Unable to connect after ${down.failures} tries: ${describeError(error)}. Still retrying.`,
            );
            await announceRealmDown(config.characterName); // realm-wide down (if every connection is now down)
          }
          await delay(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 60_000);
        }
      }
      if (!shuttingDown) await delay(1_000);
    }
  };

  const runListenerLoop = async (listener: ListenerConfig): Promise<void> => {
    const log = prefixed(logger, listener.characterName);
    // Tag each buff detection with the listener that heard it, so the notification
    // line names its source even when the three characters' logs interleave.
    const onBuff = (faction: Faction, source: string, text: string): void =>
      recordBuff(faction, source, text, listener.characterName);
    const down = new DownTracker(DOWN_ALERT_THRESHOLD);
    let backoffMs = 5_000;
    while (!shuttingDown) {
      try {
        await runListener(config, listener, log, client, onBuff, outreach, yellSink, listenerWho, whisperPool, () =>
          announceRealmUp(listener.characterName),
        );
        log.warn("connection closed; reconnecting shortly");
        backoffMs = 5_000;
        if (down.recover()) {
          await notifyAdmin(`✅ Listener back online: ${listener.characterName}`, "Reconnected; its capital's buff detection is live again.");
        }
      } catch (error) {
        if (error instanceof VersionMismatchError) {
          // The watcher's self-heal fixes the shared client build; wait and retry (not a listener fault).
          log.warn(`${error.message}; waiting for the watcher to resolve the build`);
        } else {
          log.warn(`${describeError(error)}; retrying in ${backoffMs / 1000}s`);
          if (down.fail()) {
            await notifyAdmin(
              `⚠️ Listener down: ${listener.characterName}`,
              `Unable to connect after ${down.failures} tries: ${describeError(error)}. Its capital's buff detection is offline until it recovers. Still retrying.`,
            );
            await announceRealmDown(listener.characterName); // realm-wide down (if every connection is now down)
          }
        }
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 60_000);
      }
      if (!shuttingDown) await delay(1_000);
    }
  };

  if (config.listeners.length > 0) {
    logger.info(`listeners: ${config.listeners.map((listener) => listener.characterName).join(", ")}`);
  }
  await Promise.all([runWatcher(), ...config.listeners.map(runListenerLoop)]);
}

/**
 * The server rejected our client version. Check the CDN for a newer build with a
 * tiny Range request and, if it changed, update `client` in place and return true.
 *
 * Kept deliberately quiet and cheap: the CDN is hit at most once per cooldown, and
 * Discord is pinged only when the build actually moves — or once when the rejection
 * can't be healed (our build already matches the CDN). A persistent rejection then
 * costs one 4-byte check every few minutes and no repeated messages.
 */
async function selfHeal(
  error: VersionMismatchError,
  config: BotConfig,
  logger: Logger,
  client: ClientValues,
  notifyAdmin: (title: string, body: string) => Promise<void>,
  heal: HealState,
): Promise<boolean> {
  if (!config.autoResolve) {
    logger.error(`${error.message} (auto-resolve disabled)`);
    await notifyAdmin(
      "Bot stopped — client version rejected",
      `${error.message}. Update WOW_BUILD, or set WOW_AUTO_RESOLVE=1.`,
    );
    return false;
  }

  // Rate-limit the CDN so a stuck rejection doesn't check on every retry.
  const now = Date.now();
  if (now - heal.lastCheckMs < HEAL_CHECK_COOLDOWN_MS) {
    logger.warn(`${error.message} — CDN checked recently, backing off without re-checking`);
    return false;
  }
  heal.lastCheckMs = now;

  logger.warn(`${error.message} — checking ${config.clientCdn} for a new build`);
  let build: number;
  try {
    build = await resolveBuild(config.clientCdn);
  } catch (resolveError) {
    logger.error(`CDN build check failed: ${describeError(resolveError)}`);
    if (!heal.alertedStuck) {
      heal.alertedStuck = true;
      await notifyAdmin(
        "⚠️ Auth rejected",
        `Client version rejected and the CDN is unreachable (${describeError(resolveError)}). Retrying quietly.`,
      );
    }
    return false;
  }

  if (build === client.build) {
    // Our build already matches the CDN, yet the server rejects it — nothing a
    // re-resolve can fix. Say so once, then keep retrying without further pings.
    logger.error(`server rejected build ${build}, which is current on the CDN`);
    if (!heal.alertedStuck) {
      heal.alertedStuck = true;
      await notifyAdmin(
        "⚠️ Auth rejected",
        `Build ${build} is current on the CDN but the server rejected it — a re-capture may be needed. Retrying quietly.`,
      );
    }
    return false;
  }

  logger.info(`build ${client.build} → ${build}; self-healed from the CDN`);
  client.build = build;
  heal.alertedStuck = false;
  await notifyAdmin("🔧 Client patch — self-healed", `Logon build updated to ${build}. Reconnecting.`);
  return true;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
