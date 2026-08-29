import { connect, type Socket } from "node:net";
import { loadConfig, parseAddress, type BotConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { describeError, FatalError, VersionMismatchError } from "./errors.js";
import { AuthClient } from "./net/auth-client.js";
import { WorldClient } from "./net/world-client.js";
import { resolveBuild } from "./net/client-resolver.js";
import { DiscordWebhookNotifier, type Notifier, type NotifyMessage } from "./notify/notifier.js";
import { formatRaidEvent, formatRaidWhisper } from "./notify/format.js";
import { RaidTracker, type RaidEvent } from "./watcher/raid-tracker.js";
import { CommandRouter } from "./chat/command-router.js";
import { WhisperQueue } from "./chat/whisper-queue.js";
import { InMemorySubscriberStore } from "./subscribers/memory-store.js";
import { MongoSubscriberStore } from "./subscribers/mongo-store.js";
import type { SubscriberStore } from "./subscribers/store.js";
import { jitter } from "./schedule.js";
import type { WhoResult } from "./protocol/who.js";

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Everything a connection needs beyond config: shared state and the alert sinks. */
interface ConnectionServices {
  readonly tracker: RaidTracker;
  readonly store: SubscriberStore;
  readonly router: CommandRouter;
  readonly push: (message: NotifyMessage) => Promise<void>;
  readonly client: ClientValues;
}

/** One connection lifetime: log in, enter world, poll /who and serve whispers. */
async function runConnection(
  config: BotConfig,
  logger: Logger,
  services: ConnectionServices,
): Promise<void> {
  const { tracker, store, router, push, client } = services;
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
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearTimeout(pollTimer);
      whisperQueue?.stop();
      if (error) reject(error);
      else resolve();
    };

    const query = { minLevel: 0, maxLevel: 100, zoneIds: [config.watchAreaId] } as const;

    // A raid event: post to Discord, then whisper every subscriber (if enabled).
    const announce = async (event: RaidEvent): Promise<void> => {
      await push(formatRaidEvent(event, config.watchAreaName));
      if (!config.whispersEnabled || !whisperQueue) return;
      try {
        const subscribers = await store.all();
        if (subscribers.length > 0) {
          whisperQueue.enqueueAll(
            subscribers.map((subscriber) => subscriber.name),
            formatRaidWhisper(event, config.watchAreaName),
          );
        }
      } catch (error) {
        logger.error(`subscribers: ${describeError(error)}`);
      }
    };

    const onWho = (result: WhoResult): void => {
      const inZone = result.players.filter((player) => player.areaId === config.watchAreaId);
      logger.debug(
        `who ${config.watchAreaName}: ${inZone.length} in zone ` +
          `(${result.players.length} returned, ${result.onlineCount} online)`,
      );
      for (const event of tracker.update(inZone)) void announce(event);
    };

    const onWhisper = (sender: string, text: string): void => {
      void (async () => {
        try {
          const replies = await router.handle(sender, text);
          for (const reply of replies) whisperQueue?.enqueue(sender, reply);
        } catch (error) {
          logger.error(`command from ${sender}: ${describeError(error)}`);
        }
      })();
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
          logger.info(
            `in world; watching ${config.watchAreaName} about every ${config.pollIntervalMs / 1000}s`,
          );
          const poll = (): void => {
            try {
              world.requestWho(query);
            } catch (error) {
              logger.warn(`who request failed: ${(error as Error).message}`);
            }
            if (settled) return;
            pollTimer = setTimeout(poll, jitter(config.pollIntervalMs, POLL_JITTER_RATIO));
            pollTimer.unref?.();
          };
          poll();
        },
        onWho,
        onWhisper: config.whispersEnabled ? onWhisper : undefined,
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
  const notifier: Notifier = new DiscordWebhookNotifier(config.discordWebhookUrl, {
    mentionRoleId: config.discordMentionRoleId,
  });
  const tracker = new RaidTracker(config.minRaidSize, config.raidGrouping);

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
  const router = new CommandRouter({ store, tracker, areaName: config.watchAreaName });
  const services: ConnectionServices = { tracker, store, router, push, client };

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
    void store.close().finally(() => process.exit(0));
  });

  const heal: HealState = { lastCheckMs: 0, alertedStuck: false };
  let backoffMs = 5_000;
  while (!shuttingDown) {
    try {
      await runConnection(config, logger, services);
      logger.warn("connection closed; reconnecting shortly");
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
        logger.warn(`connection error: ${describeError(error)}; retrying in ${backoffMs / 1000}s`);
        await delay(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 60_000);
      }
    }
    if (!shuttingDown) await delay(1_000);
  }
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
