import type { Db } from "mongodb";
import { describeError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { ShadowNotice } from "./format.js";
import { InMemorySpireRunStore, MongoSpireRunStore, type SpireRunStore } from "./run-store.js";
import { SpireRunTracker } from "./spire-runs.js";
import {
  InMemorySpireSnapshotStore,
  MongoSpireSnapshotStore,
  type SpireSnapshotStore,
} from "./spire-snapshot-store.js";
import { SpireWatch } from "./spire-watch.js";

/**
 * Builds the Warchief's Blessing shadow forecast with its stores: MongoDB when the bot has it — the
 * point is to keep every reading for replay — else memory, which still forecasts live but forgets on
 * restart. A store that will not open falls back to memory on its own, logged, like the bot's others.
 */

export interface SpireWatchWiring {
  readonly database: Db | null;
  /** The Warchief's Blessings heard, from the Warchief tracker's store. */
  readonly blessings: () => Promise<readonly Date[]>;
  /** The tests channel — never players. */
  readonly notify: (notice: ShadowNotice) => Promise<void>;
  readonly logger: Logger;
}

export interface OpenedSpireWatch {
  readonly watch: SpireWatch;
  /** Release its stores, at shutdown. */
  close(): Promise<void>;
}

/** The store `open` yields, or the in-memory one when there is no database or it will not open. */
export async function orMemory<T>(what: string, logger: Logger, open: (() => Promise<T>) | null, memory: () => T): Promise<T> {
  if (open === null) {
    logger.info(`${what}: no MongoDB — keeping it in memory, lost on restart`);
    return memory();
  }
  try {
    const store = await open();
    logger.info(`${what}: recording to MongoDB`);
    return store;
  } catch (error) {
    logger.error(`${what}: MongoDB connect failed (${describeError(error)}); keeping it in memory`);
    return memory();
  }
}

export async function openSpireWatch(wiring: SpireWatchWiring): Promise<OpenedSpireWatch> {
  const { database, logger } = wiring;
  const snapshots: SpireSnapshotStore = await orMemory<SpireSnapshotStore>(
    "spire readings",
    logger,
    database ? () => MongoSpireSnapshotStore.open(database) : null,
    () => new InMemorySpireSnapshotStore(),
  );
  const runs: SpireRunStore = await orMemory<SpireRunStore>(
    "spire runs",
    logger,
    database ? () => MongoSpireRunStore.open(database) : null,
    () => new InMemorySpireRunStore(),
  );
  const watch = new SpireWatch({
    tracker: new SpireRunTracker(),
    snapshots,
    runs,
    blessings: wiring.blessings,
    notify: wiring.notify,
    logger,
  });
  await watch
    .warmUp(Date.now())
    .catch((error) => logger.error(`spire: could not pick up from the kept readings (${describeError(error)})`));
  return {
    watch,
    close: async () => {
      await Promise.allSettled([snapshots.close(), runs.close()]);
    },
  };
}
