import { connect, type Socket } from "node:net";
import { loadConfig, parseAddress, type BotConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { describeError, FatalError } from "./errors.js";
import { AuthClient } from "./net/auth-client.js";
import { WorldClient } from "./net/world-client.js";
import { DiscordWebhookNotifier, type Notifier, type NotifyMessage } from "./notify/notifier.js";
import { formatEvent } from "./notify/format.js";
import { OnyxiaWatcher } from "./watcher/onyxia-watcher.js";
import { jitter } from "./schedule.js";
import type { WhoResult } from "./protocol/who.js";

/** +/- 15% randomization on the poll interval so the cadence isn't a fixed tick. */
const POLL_JITTER_RATIO = 0.15;

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

/** One connection lifetime: log in, enter world, poll /who until the link drops. */
async function runConnection(
  config: BotConfig,
  logger: Logger,
  onWho: (result: WhoResult) => void,
): Promise<void> {
  const { sessionKey, realms } = await new AuthClient(logger).login({
    host: config.authHost,
    port: config.authPort,
    username: config.account,
    password: config.password,
    integrityChecksum: config.integrityChecksum,
  });

  const target = resolveWorldTarget(config, realms, logger);
  const socket = await connectSocket(target.host, target.port);

  await new Promise<void>((resolve, reject) => {
    let pollTimer: NodeJS.Timeout | null = null;
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (error) reject(error);
      else resolve();
    };

    const query = { minLevel: 0, maxLevel: 100, zoneIds: [config.watchAreaId] } as const;

    const world = new WorldClient({
      socket,
      account: config.account,
      sessionKey,
      characterName: config.characterName,
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
        onWho: onWho,
        onError: (error) => {
          world.close();
          settle(error);
        },
        onClose: () => settle(new Error("world connection closed")),
      },
    });

    world.start();
  });
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
  const watcher = new OnyxiaWatcher();

  const push = async (message: NotifyMessage): Promise<void> => {
    try {
      await notifier.notify(message);
    } catch (error) {
      logger.error(`discord: ${(error as Error).message}`);
    }
  };

  const onWho = (result: WhoResult): void => {
    const inZone = result.players.filter((player) => player.areaId === config.watchAreaId);
    logger.debug(
      `who ${config.watchAreaName}: ${inZone.length} in zone ` +
        `(${result.players.length} returned, ${result.onlineCount} online)`,
    );
    for (const event of watcher.update(inZone)) {
      void push(formatEvent(event, config.watchAreaName));
    }
  };

  logger.info(`turtle-onyxia-bot starting as ${config.characterName}`);
  await push({
    kind: "info",
    title: `👁️ Watching ${config.watchAreaName}`,
    body: `Bot online as ${config.characterName}, polling every ${config.pollIntervalMs / 1000}s.`,
  });

  let shuttingDown = false;
  process.on("SIGINT", () => {
    shuttingDown = true;
    logger.info("shutting down");
    process.exit(0);
  });

  let backoffMs = 5_000;
  while (!shuttingDown) {
    try {
      await runConnection(config, logger, onWho);
      logger.warn("connection closed; reconnecting shortly");
      backoffMs = 5_000;
    } catch (error) {
      if (error instanceof FatalError) {
        logger.error(error.message);
        await push({ kind: "error", title: "Bot stopped", body: error.message });
        process.exit(1);
      }
      logger.warn(`connection error: ${describeError(error)}; retrying in ${backoffMs / 1000}s`);
      await delay(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
    if (!shuttingDown) await delay(1_000);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
