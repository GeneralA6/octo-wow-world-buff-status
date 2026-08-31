import { connect, type Socket } from "node:net";
import { loadConfig, parseAddress, type BotConfig, type ListenerConfig } from "./config.js";
import { createLogger, prefixed, type Logger } from "./logger.js";
import { describeError, FatalError, VersionMismatchError } from "./errors.js";
import { AuthClient } from "./net/auth-client.js";
import { WorldClient } from "./net/world-client.js";
import { resolveBuild } from "./net/client-resolver.js";
import { DiscordWebhookNotifier, type Notifier, type NotifyMessage } from "./notify/notifier.js";
import { DiscordDmSender } from "./notify/discord-dm.js";
import { DiscordGateway } from "./notify/discord-gateway.js";
import { registerLinkCommand, replyToInteraction } from "./notify/discord-commands.js";
import { DiscordInvites } from "./notify/discord-invites.js";
import { InviteLinker } from "./notify/invite-linker.js";
import {
  formatBuffAlert,
  formatBuffDropped,
  formatBuffDroppedWhisper,
  formatBuffWhisper,
} from "./notify/format.js";
import { groupByRelevantCities } from "./notify/faction-routing.js";
import type { RaidEvent } from "./watcher/raid-tracker.js";
import { summarizeDepartures } from "./watcher/presence.js";
import { fetchRoster, type Roster } from "./watcher/roster.js";
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
import { factionOfRace, splitByFaction, type FactionSplit } from "./watcher/faction.js";
import { shouldAlertForRaid } from "./watcher/buff-gate.js";
import { CommandRouter } from "./chat/command-router.js";
import { Outreach } from "./chat/outreach.js";
import { DiscordLinker } from "./chat/discord-linker.js";
import { WhisperQueue } from "./chat/whisper-queue.js";
import { InMemorySubscriberStore } from "./subscribers/memory-store.js";
import { MongoSubscriberStore } from "./subscribers/mongo-store.js";
import { PendingLinks } from "./subscribers/pending-links.js";
import { subscriberKey, type AlertType, type Subscriber, type SubscriberStore } from "./subscribers/store.js";
import { jitter } from "./schedule.js";

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

/** How long an offline-mode Discord fallback waits for a whisper to bounce. */
const OFFLINE_FALLBACK_TTL_MS = 60_000;

/** Max time from connecting to reaching in-world before the handshake is deemed stalled. */
const WORLD_READY_TIMEOUT_MS = 30_000;

/** How often the watcher logs its monitoring heartbeat (subs, learned timer, buffs). */
const HEARTBEAT_MS = 15 * 60_000;

/** Re-check for a nearby object this often, and give up after this many tries. The
 *  object burst can arrive over several seconds, so we poll rather than wait once. */
const OBJECT_POLL_MS = 2_500;
const OBJECT_POLL_MAX = 12;
/** Only interact with an object we're basically standing ON. A character parked on a
 *  bench sits ~0.5yd from it; anything further is a different object she isn't on. */
const OBJECT_INTERACT_MAX_YD = 3;

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
  notify: ((faction: Faction, appliedAt: Date) => void) | null;
}

/** Everything a connection needs beyond config: shared state and the alert sinks. */
interface ConnectionServices {
  readonly lanes: readonly DetectionLane[];
  readonly buffStore: BuffStore;
  readonly durationStore: DurationStore;
  readonly snapshots: SnapshotStore;
  readonly store: SubscriberStore;
  readonly router: CommandRouter;
  readonly dm: DiscordDmSender;
  readonly outreach: Outreach;
  readonly buffDropSink: BuffDropSink;
  readonly push: (message: NotifyMessage) => Promise<void>;
  readonly client: ClientValues;
}

/**
 * The capitals where this raid could produce a FRESH buff — those whose buff has, or
 * will have by the time the raid finishes, expired. A forming raid is predicted to end
 * a clear-time from now; an ending raid is finishing now. Empty means stay silent
 * (every candidate city still has an active buff, so the head would be banked).
 */
async function openCitiesFor(
  event: RaidEvent,
  cities: readonly Faction[],
  buffStore: BuffStore,
  now: number,
  raidDurationMs: number,
): Promise<Faction[]> {
  const predictedEndMs = event.kind === "raid-forming" ? now + raidDurationMs : now;
  const open: Faction[] = [];
  for (const city of cities) {
    const buff = await buffStore.current(city, new Date(now));
    if (shouldAlertForRaid(buff, predictedEndMs, now).alert) open.push(city);
  }
  return open;
}

/** One connection lifetime: log in, enter world, poll /who and serve whispers. */
async function runConnection(
  config: BotConfig,
  logger: Logger,
  services: ConnectionServices,
): Promise<void> {
  const { lanes, buffStore, durationStore, snapshots, store, router, dm, outreach, buffDropSink, push, client } =
    services;
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
    let whisperQueue: WhisperQueue | null = null;
    // The world server can accept the TCP connection but stall the handshake, and
    // there's no other timeout past connect — so bound the time to reach in-world.
    let readyTimer: NodeJS.Timeout | null = null;
    // Throttles the monitoring heartbeat; 0 so the first poll after connect logs one.
    let lastHeartbeatAt = 0;
    // Offline-mode subscribers whose in-game whisper may bounce → DM them instead.
    const offlinePending = new Map<string, { discordId: string; message: string; timer: NodeJS.Timeout }>();
    const clearOfflinePending = (): void => {
      for (const { timer } of offlinePending.values()) clearTimeout(timer);
      offlinePending.clear();
    };

    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (readyTimer) clearTimeout(readyTimer);
      whisperQueue?.stop();
      outreach.setChannel(null, null); // watcher going away — stop greeting through it
      router.setGuildInvite(null); // and stop offering guild invites until reconnected
      router.setFactionLookup(null); // and stop the /who-based faction detection
      buffDropSink.notify = null; // and stop routing buff-drop whispers until reconnected
      clearOfflinePending();
      if (error) reject(error);
      else resolve();
    };

    // Arm a Discord DM for an offline-mode subscriber; delivered if their whisper
    // bounces, else it expires quietly (they were online, got it in-game).
    const armOfflineFallback = (name: string, discordId: string, message: string): void => {
      const key = name.toLowerCase();
      const existing = offlinePending.get(key);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => offlinePending.delete(key), OFFLINE_FALLBACK_TTL_MS);
      timer.unref?.();
      offlinePending.set(key, { discordId, message, timer });
    };

    // A buff-parking alert: post to the Discord channel, whisper every subscriber
    // in-game, DM "both"-mode subscribers, arm the DM fallback for "offline"-mode ones.
    const announceBuff = async (event: RaidEvent, cities: readonly Faction[]): Promise<void> => {
      const message = formatBuffAlert(event, cities, config.watchAreaName);
      logger.info(`ALERT ${event.kind} (${cities.join("/")}): ${message.body}`);
      await push(message);
      if (!config.whispersEnabled) return;

      // Only whisper/DM subscribers who want this alert type (the Discord channel
      // post above went to everyone regardless).
      const alertType: AlertType = event.kind === "raid-forming" ? "forming" : "cleared";
      let subscribers: Subscriber[] = [];
      try {
        subscribers = await store.all();
      } catch (error) {
        logger.error(`subscribers: ${describeError(error)}`);
        return;
      }
      subscribers = subscribers.filter((subscriber) => subscriber.alerts.includes(alertType));
      if (subscribers.length === 0) return;

      // Group by which of the open cities each subscriber cares about, so each hears one
      // message naming only their own side (alliance → Stormwind, horde → Orgrimmar).
      for (const { cities: groupCities, members } of groupByRelevantCities(subscribers, cities)) {
        const line = formatBuffWhisper(event, groupCities, config.watchAreaName);
        // "discord"-mode subscribers get no whisper; everyone else does.
        const whisperNames = members.filter((s) => s.delivery !== "discord").map((s) => s.name);
        whisperQueue?.enqueueAll(whisperNames, line);
        for (const subscriber of members) {
          if (!subscriber.discordId) continue;
          if (subscriber.delivery === "both" || subscriber.delivery === "discord") {
            void dm.send(subscriber.discordId, line); // Discord every time
          } else if (subscriber.delivery === "offline") {
            armOfflineFallback(subscriber.name, subscriber.discordId, line); // DM only if the whisper bounces
          }
          // "ingame": no Discord DM
        }
      }
    };

    // A buff DROP (heard on a listener, routed here via the sink): whisper/DM only that
    // side's subscribers — the payoff event finally reaches people in-game, not just the
    // Discord channel. Gated on wanting alerts at all (notify none = silence).
    const announceBuffDrop = async (faction: Faction, appliedAt: Date): Promise<void> => {
      if (!config.whispersEnabled) return;
      let subscribers: Subscriber[] = [];
      try {
        subscribers = await store.all();
      } catch (error) {
        logger.error(`subscribers: ${describeError(error)}`);
        return;
      }
      subscribers = subscribers.filter((s) => s.factions.includes(faction) && s.alerts.length > 0);
      if (subscribers.length === 0) return;

      const line = formatBuffDroppedWhisper(faction, appliedAt, config.buffDurationMs);
      const dmLine = formatBuffDropped(faction, appliedAt, config.buffDurationMs).body;
      const whisperNames = subscribers.filter((s) => s.delivery !== "discord").map((s) => s.name);
      whisperQueue?.enqueueAll(whisperNames, line);
      for (const s of subscribers) {
        if (!s.discordId) continue;
        if (s.delivery === "both" || s.delivery === "discord") void dm.send(s.discordId, dmLine);
        else if (s.delivery === "offline") armOfflineFallback(s.name, s.discordId, dmLine);
      }
    };

    // A whisper bounced: the target is offline — deliver their armed Discord DM.
    const onWhisperUndelivered = (target: string): void => {
      const key = target.toLowerCase();
      const pending = offlinePending.get(key);
      if (!pending) return;
      clearTimeout(pending.timer);
      offlinePending.delete(key);
      void dm.send(pending.discordId, pending.message);
    };

    // One detection lane: census, then gate each raid event against its candidate
    // city buffs before it becomes a park-in-the-city alert.
    const processLane = async (
      lane: DetectionLane,
      split: FactionSplit,
      complete: boolean,
      now: number,
      raidDurationMs: number,
    ): Promise<void> => {
      const obs = lane.watch.observe(lane.players(split), now, complete);

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

      // The configured detector drives alerts; the other is shadow-logged for validation.
      const useTemporal = config.raidDetector === "temporal";
      const events = useTemporal ? obs.temporalEvents : obs.countEvents;
      const shadow = useTemporal ? obs.countEvents : obs.temporalEvents;
      for (const event of events) {
        const open = await openCitiesFor(event, lane.cities, buffStore, now, raidDurationMs);
        if (open.length > 0) await announceBuff(event, open);
        else logger.info(`${lane.label} ${event.kind} suppressed — every candidate city still has an active buff`);
      }
      for (const event of shadow) {
        logger.info(
          `${useTemporal ? "count" : "temporal"}(shadow) ${lane.label}: would ${event.kind} — ${event.cohort.label} peak ${event.cohort.peak}`,
        );
      }

      // Self-improving timer: record every observed form→clear duration (the temporal
      // detector measures it), then log the learned median vs the estimate in use.
      for (const event of obs.temporalEvents) {
        if (event.kind !== "raid-left" || event.durationMs === undefined) continue;
        const ms = event.durationMs;
        // A raid that "cleared" faster than a real Onyxia clear can happen is churn —
        // a crowd that gathered and scattered (common during a flaky server) — not a
        // real run. Drop it so it can't drag the learned median down.
        if (!isPlausibleClear(ms, config.raidMinClearMs)) {
          logger.info(
            `raid clear ignored: ~${mins(ms)}m is below the ${mins(config.raidMinClearMs)}m floor — churn, not a real clear`,
          );
          continue;
        }
        void (async () => {
          await durationStore.record({ ms, ts: new Date(now) });
          const [learned, samples] = await Promise.all([
            durationStore.median(config.raidLearnMinSamples),
            durationStore.count(),
          ]);
          logger.info(
            `raid clear recorded: ~${mins(ms)}m (${samples} samples; ` +
              (learned
                ? `learned median ${mins(learned)}m now driving the heads-up`
                : `need ${config.raidLearnMinSamples} to switch off the ${mins(config.raidDurationEstimateMs)}m estimate`) +
              ")",
          );
        })().catch((error) => logger.debug(`duration: ${describeError(error)}`));
      }
    };

    const logHeartbeat = async (now: number): Promise<void> => {
      const [samples, learnedMedianMs, subscribers, buffs] = await Promise.all([
        durationStore.count(),
        durationStore.median(config.raidLearnMinSamples),
        store.all().then((all) => all.length),
        Promise.all(
          FACTIONS.map(async (faction) => {
            const state = await buffStore.current(faction, new Date(now));
            const leftMs = state?.active ? state.expiresAt.getTime() - now : null;
            return { faction, leftMs };
          }),
        ),
      ]);
      logger.info(
        formatHeartbeat({
          subscribers,
          samples,
          learnedMedianMs,
          estimateMs: config.raidDurationEstimateMs,
          minSamples: config.raidLearnMinSamples,
          buffs,
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
          (roster.sliced ? ` [class-sliced, complete=${complete}]` : ""),
      );

      // Persist the raw observation for offline replay/stats.
      void snapshots
        .record({ ts: new Date(now), present: inZone.length, complete, names: inZone.map((p) => p.name) })
        .catch((error) => logger.debug(`snapshot: ${describeError(error)}`));

      // Surface the MongoDB-only stats into the logs on a slow cadence, so the
      // self-improving timer's progress and the buff state are observable at a glance.
      if (now - lastHeartbeatAt >= HEARTBEAT_MS) {
        lastHeartbeatAt = now;
        void logHeartbeat(now).catch((error) => logger.debug(`monitor: ${describeError(error)}`));
      }

      // The forming heads-up predicts a raid's end from the LEARNED median clear time
      // once enough raids are on record, else the config estimate.
      const learnedMs = await durationStore.median(config.raidLearnMinSamples).catch(() => null);
      const raidDurationMs = learnedMs ?? config.raidDurationEstimateMs;

      const split = splitByFaction(inZone);
      // In faction mode unmapped races belong to no lane; log them so a custom Turtle/
      // Octo race id can be added to the map. (Crossfaction's lair lane includes them.)
      if (config.realmType === "faction" && split.unknown.length > 0) {
        const races = [...new Set(split.unknown.map((player) => player.raceId))].join(", ");
        logger.info(`${split.unknown.length} in zone with unmapped race ids [${races}] — not attributed`);
      }
      for (const lane of lanes) {
        await processLane(lane, split, complete, now, raidDurationMs);
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

    // Detect a new subscriber's side with a targeted /who — they're online, having just
    // whispered. Best-effort: they stay on "both" if it can't run or their race is custom.
    const lookupFaction = async (name: string): Promise<void> => {
      try {
        const result = await queuedWho({ minLevel: 0, maxLevel: 100, playerName: name });
        const player = result.players.find((p) => subscriberKey(p.name) === subscriberKey(name));
        const faction = player ? factionOfRace(player.raceId) : null;
        if (!faction) return; // offline, not found, or a custom race — leave them on "both"
        if (await store.update(name, { factions: [faction] })) {
          logger.info(`faction: detected ${name} as ${faction}`);
        }
      } catch (error) {
        logger.debug(`faction lookup for ${name}: ${describeError(error)}`);
      }
    };

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
          // Offer Bufftracker's outbound channel so listeners can greet players through it,
          // and give the command router the guild-invite capability for the "invite" command.
          if (config.whispersEnabled) {
            outreach.setChannel(
              (nameTo, msg) => whisperQueue?.enqueue(nameTo, msg),
              (nameTo) => world.guildInvite(nameTo),
            );
            router.setGuildInvite((nameTo) => world.guildInvite(nameTo));
            // The watcher can now whisper, so route listener-heard buff drops through it.
            buffDropSink.notify = (faction, appliedAt) =>
              void announceBuffDrop(faction, appliedAt).catch((error) =>
                logger.error(`buff-drop announce: ${describeError(error)}`),
              );
          }
          router.setFactionLookup((name) => void lookupFaction(name));
          const poll = async (): Promise<void> => {
            try {
              const roster = await fetchRoster(queuedWho, config.watchAreaId);
              if (!settled) await processRoster(roster);
            } catch (error) {
              logger.warn(`who failed: ${describeError(error)}`);
            }
            if (settled) return;
            pollTimer = setTimeout(() => void poll(), jitter(config.pollIntervalMs, POLL_JITTER_RATIO));
            pollTimer.unref?.();
          };
          void poll();
        },
        onWhisper: config.whispersEnabled ? onWhisper : undefined,
        onWhisperUndelivered: config.whispersEnabled ? onWhisperUndelivered : undefined,
        onError: (error) => {
          world.close();
          settle(error);
        },
        onClose: () => settle(new Error("world connection closed")),
      },
    });

    whisperQueue = new WhisperQueue(
      (targetName, message) => world.whisper(targetName, message),
      config.whisperThrottleMs,
      (error, targetName) => logger.debug(`whisper to ${targetName} failed: ${describeError(error)}`),
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
 * A listener session: log in a city-parked character, reach the world, and forward
 * buff yells. No /who, no whispers — its only job is to hear its capital's yell so
 * the buff-drop time is known. Shares the client identity so a patch heals once.
 */
async function runListener(
  config: BotConfig,
  listener: ListenerConfig,
  logger: Logger,
  client: ClientValues,
  onBuffApplied: (faction: Faction, sourceName: string, text: string) => void,
  outreach: Outreach,
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
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (readyTimer) clearTimeout(readyTimer);
      if (interactTimer) clearTimeout(interactTimer);
      if (error) reject(error);
      else resolve();
    };

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
          if (listener.onLogin === "sit") world.sit();
          else if (listener.onLogin === "interact") {
            // The object burst trickles in over several seconds, so poll: as soon as a
            // GameObject is within reach (the one she's parked on), use it. Only a close
            // object counts — a far transport is never what she's sitting on.
            let attempts = 0;
            const tryInteract = (): void => {
              attempts += 1;
              const target = selfPos ? nearestGameObject(nearby, selfPos) : null;
              const dist =
                target && selfPos
                  ? Math.hypot(target.pos.x - selfPos.x, target.pos.y - selfPos.y, target.pos.z - selfPos.z)
                  : Infinity;
              if (target && dist <= OBJECT_INTERACT_MAX_YD) {
                interacted = true;
                logger.info(
                  `${listener.characterName}: using nearest object entry=${target.entry} (~${dist.toFixed(1)} yd)`,
                );
                world.useGameObject(target.guid);
                return;
              }
              if (attempts >= OBJECT_POLL_MAX) {
                interacted = true;
                const sp = selfPos;
                const closest = sp
                  ? [...nearby]
                      .map((go) => ({
                        entry: go.entry,
                        d: Math.hypot(go.pos.x - sp.x, go.pos.y - sp.y, go.pos.z - sp.z),
                      }))
                      .sort((a, b) => a.d - b.d)
                      .slice(0, 5)
                      .map((c) => `${c.entry}@${c.d.toFixed(1)}`)
                      .join(", ")
                  : "n/a";
                logger.warn(
                  `${listener.characterName}: no object within ${OBJECT_INTERACT_MAX_YD}yd after ${attempts} tries ` +
                    `(self=${sp ? `(${sp.x.toFixed(0)},${sp.y.toFixed(0)},${sp.z.toFixed(0)})` : "no"}, ` +
                    `objects=${nearby.length}, closest=[${closest}])`,
                );
                return;
              }
              interactTimer = setTimeout(tryInteract, OBJECT_POLL_MS);
              interactTimer.unref?.();
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
        // A player whispered this parked character → log it (tagged with this
        // listener's name) and have Bufftracker greet them. The listener itself does
        // not answer commands — that's Bufftracker — so this is a greet-only surface.
        onWhisper: (sender, text) => {
          logger.info(`whisper from ${sender}: ${JSON.stringify(text)} (greet-only; commands go to ${config.characterName})`);
          outreach.onListenerContact(sender);
        },
        onWorldObjects:
          listener.onLogin === "interact"
            ? (raw) => {
                if (interacted) return;
                // parseUpdateObject returns partial results (never throws) on a shape
                // it can't decode, so we keep whatever GameObjects it read.
                const parsed = parseUpdateObject(raw);
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
  push: (message: NotifyMessage) => Promise<void>,
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
    await push({
      kind: "error",
      title: "⚠️ Subscriber store offline",
      body: "MongoDB is unreachable — in-game subscriptions are in memory until restart.",
    });
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

  const notifier: Notifier = new DiscordWebhookNotifier(config.discordWebhookUrl, {
    mentionRoleId: config.discordMentionRoleId,
  });
  const watchOptions: RaidWatchOptions = {
    minRaidSize: config.minRaidSize,
    grouping: config.raidGrouping,
    clearSize: config.raidClearSize,
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

  // Client identity values; re-resolved from the CDN if the server rejects them.
  const client: ClientValues = {
    build: config.build,
    worldBuild: config.worldBuild,
    integrityChecksum: config.integrityChecksum,
  };

  const push = async (message: NotifyMessage): Promise<void> => {
    try {
      await notifier.notify(message);
    } catch (error) {
      logger.error(`discord: ${(error as Error).message}`);
    }
  };

  const store = config.whispersEnabled
    ? await openStore(config, logger, push)
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
  let buffStore: BuffStore = new InMemoryBuffStore(config.buffDurationMs);
  if (config.mongodbUri) {
    try {
      buffStore = await MongoBuffStore.connect(config.mongodbUri, config.mongodbDb, config.buffDurationMs);
      logger.info("buffs: recording drop times to MongoDB");
    } catch (error) {
      logger.error(`buffs: MongoDB connect failed (${describeError(error)}); recording in memory`);
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

  // The watcher fills this once in world, so a listener-heard buff drop can be whispered.
  const buffDropSink: BuffDropSink = { notify: null };

  const recordBuff = (faction: Faction, sourceName: string, text: string, detectedBy: string): void => {
    const appliedAt = new Date();
    logger.info(`buff drop: ${faction} buff is up — ${detectedBy} heard "${text}" from ${sourceName}`);
    void buffStore
      .record({ faction, appliedAt })
      .catch((error) => logger.error(`buff-store: ${describeError(error)}`));
    // Announce it: the Discord channel post, and (via the watcher) that side's subscribers.
    void push(formatBuffDropped(faction, appliedAt, config.buffDurationMs));
    buffDropSink.notify?.(faction, appliedAt);
  };

  // Discord DM delivery + linking (only when a bot token is configured).
  const dm = new DiscordDmSender(config.discordBotToken);
  const linker = new DiscordLinker({
    store,
    pending: new PendingLinks(),
    dm,
    serverInviteUrl: config.discordServerInvite,
    areaName: config.watchAreaName,
  });
  // Personal-invite linking: the bot mints a per-character invite and links the joiner
  // automatically. Off (no-op) unless a bot token + guild + channel are all configured.
  const inviteLinker = new InviteLinker({
    invites: new DiscordInvites(config.discordBotToken),
    store,
    dm,
    guildId: config.discordGuildId,
    channelId: config.discordInviteChannelId,
    areaName: config.watchAreaName,
    logger,
  });
  const router = new CommandRouter({
    store,
    activeRaids: () => lanes.flatMap((lane) => lane.watch.activeRaids()),
    areaName: config.watchAreaName,
    guildName: config.guildName,
    community: config.community,
    linker: dm.isConfigured ? linker : null,
    mintInvite: inviteLinker.isConfigured ? (character) => inviteLinker.mintFor(character) : undefined,
  });
  const outreach = new Outreach(
    { guildName: config.guildName, community: config.community, guildInviteEnabled: config.guildInviteEnabled },
    logger,
  );
  const services: ConnectionServices = {
    lanes,
    buffStore,
    durationStore,
    snapshots,
    store,
    router,
    dm,
    outreach,
    buffDropSink,
    push,
    client,
  };

  // Link flow A: listen for DMs the bot receives and complete any pending code.
  let gateway: DiscordGateway | null = null;
  const botToken = config.discordBotToken;
  if (config.whispersEnabled && botToken && config.discordGateway) {
    const inviteWired = inviteLinker.isConfigured;
    gateway = new DiscordGateway({
      token: botToken,
      logger,
      onDirectMessage: (authorId, content) => {
        void (async () => {
          try {
            const character = await linker.confirmFromDm(authorId, content);
            if (character) logger.info(`discord: linked ${character} via DM`);
          } catch (error) {
            logger.error(`discord link: ${describeError(error)}`);
          }
        })();
      },
      onReady: (applicationId) => {
        // Register /link as a guild command (instant) so already-in-Discord users can
        // link with one step, and snapshot invite counts for personal-invite linking.
        if (config.discordGuildId) {
          void registerLinkCommand(botToken, applicationId, config.discordGuildId)
            .then((ok) => logger.info(`discord: /link command ${ok ? "registered" : "registration FAILED"}`))
            .catch((error) => logger.error(`/link register: ${describeError(error)}`));
        }
        if (inviteWired) {
          void inviteLinker
            .refresh()
            .then((ok) =>
              logger.info(
                ok
                  ? "invite-link: tracking invites (personal-invite linking active)"
                  : "invite-link: could NOT read invites — check the bot has MANAGE_GUILD and the Server Members intent",
              ),
            )
            .catch((error) => logger.error(`invite-link refresh: ${describeError(error)}`));
        }
      },
      onGuildMemberAdd: inviteWired
        ? (userId) =>
            void inviteLinker
              .onMemberJoin(userId)
              .catch((error) => logger.error(`invite-link join: ${describeError(error)}`))
        : undefined,
      onInteraction: (interaction) => {
        if (interaction.commandName !== "link" || !interaction.userId) return;
        const userId = interaction.userId;
        const character = interaction.options.character?.trim();
        void (async () => {
          if (!character) {
            await replyToInteraction(interaction, "Add your character name: /link <character>");
            return;
          }
          await linker.linkByCommand(character, userId);
          logger.info(`discord: /link ${character} -> ${userId}`);
          await replyToInteraction(
            interaction,
            `Linked ${character}! You'll get its Onyxia buff alerts here. Run /link again anytime to change it.`,
          );
        })().catch((error) => logger.error(`/link: ${describeError(error)}`));
      },
    });
    gateway.start();
    logger.info(
      `discord gateway: started (DM linking${inviteWired ? " + personal-invite linking" : ""} active)`,
    );
  }

  logger.info(`turtle-onyxia-bot starting as ${config.characterName}`);
  if (config.announceStartup) {
    await push({
      kind: "info",
      title: `👁️ Watching ${config.watchAreaName}`,
      body: `Bot online as ${config.characterName}, polling every ${config.pollIntervalMs / 1000}s.`,
    });
  }

  let shuttingDown = false;
  process.on("SIGINT", () => {
    shuttingDown = true;
    logger.info("shutting down");
    gateway?.stop();
    void Promise.allSettled([store.close(), snapshots.close(), buffStore.close(), durationStore.close()]).finally(() =>
      process.exit(0),
    );
  });

  // The watcher does /who + alerts + whispers; each listener only forwards buff yells.
  // They run concurrently, each with its own self-reconnecting supervisor.
  const watcherLog = prefixed(logger, config.characterName);
  const runWatcher = async (): Promise<void> => {
    const heal: HealState = { lastCheckMs: 0, alertedStuck: false };
    let backoffMs = 5_000;
    while (!shuttingDown) {
      try {
        await runConnection(config, watcherLog, services);
        watcherLog.warn("connection closed; reconnecting shortly");
        backoffMs = 5_000;
        heal.alertedStuck = false; // a clean run clears the "stuck" latch
      } catch (error) {
        if (error instanceof VersionMismatchError) {
          if (await selfHeal(error, config, logger, client, push, heal)) {
            backoffMs = 5_000; // resolved — retry promptly with the new build
          } else if (!config.autoResolve) {
            process.exit(1); // can't self-heal and it's disabled: stop
          } else {
            await delay(backoffMs); // can't heal right now; back off and retry quietly
            backoffMs = Math.min(backoffMs * 2, 60_000);
          }
        } else if (error instanceof FatalError) {
          logger.error(error.message);
          await push({ kind: "error", title: "Bot stopped", body: error.message });
          process.exit(1);
        } else {
          watcherLog.warn(`connection error: ${describeError(error)}; retrying in ${backoffMs / 1000}s`);
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
    let backoffMs = 5_000;
    while (!shuttingDown) {
      try {
        await runListener(config, listener, log, client, onBuff, outreach);
        log.warn("connection closed; reconnecting shortly");
        backoffMs = 5_000;
      } catch (error) {
        if (error instanceof VersionMismatchError) {
          // The watcher's self-heal fixes the shared client build; wait and retry.
          log.warn(`${error.message}; waiting for the watcher to resolve the build`);
        } else {
          log.warn(`${describeError(error)}; retrying in ${backoffMs / 1000}s`);
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
  push: (message: NotifyMessage) => Promise<void>,
  heal: HealState,
): Promise<boolean> {
  if (!config.autoResolve) {
    logger.error(`${error.message} (auto-resolve disabled)`);
    await push({
      kind: "error",
      title: "Bot stopped — client version rejected",
      body: `${error.message}. Update WOW_BUILD, or set WOW_AUTO_RESOLVE=1.`,
    });
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
      await push({
        kind: "error",
        title: "⚠️ Auth rejected",
        body: `Client version rejected and the CDN is unreachable (${describeError(resolveError)}). Retrying quietly.`,
      });
    }
    return false;
  }

  if (build === client.build) {
    // Our build already matches the CDN, yet the server rejects it — nothing a
    // re-resolve can fix. Say so once, then keep retrying without further pings.
    logger.error(`server rejected build ${build}, which is current on the CDN`);
    if (!heal.alertedStuck) {
      heal.alertedStuck = true;
      await push({
        kind: "error",
        title: "⚠️ Auth rejected",
        body: `Build ${build} is current on the CDN but the server rejected it — a re-capture may be needed. Retrying quietly.`,
      });
    }
    return false;
  }

  logger.info(`build ${client.build} → ${build}; self-healed from the CDN`);
  client.build = build;
  heal.alertedStuck = false;
  await push({
    kind: "info",
    title: "🔧 Client patch — self-healed",
    body: `Logon build updated to ${build}. Reconnecting.`,
  });
  return true;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
