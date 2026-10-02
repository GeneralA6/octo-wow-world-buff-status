import type { ChronicleClient } from "./chronicle/client.js";
import type { ChronicleStore } from "./chronicle/store.js";
import type { WhoPlayer } from "./protocol/who.js";
import type { Faction } from "./watcher/buff-store.js";
import type { FactionSplit } from "./watcher/faction.js";
import type { RaidTracker } from "./watcher/raid-tracker.js";

/**
 * The small wiring types shared between index.ts (which builds the connection) and the raid service
 * (which consumes a lane's watch + chronicle). Kept here, not in index.ts, so a leaf module never has
 * to import the entry point for a type.
 *
 * One detection lane: a raid watch over some slice of the lair, and the cities it gates. Crossfaction
 * is one lane over the whole lair gating both cities; a faction realm is one lane per side.
 */
export interface DetectionLane {
  readonly label: string;
  readonly watch: RaidTracker;
  readonly cities: readonly Faction[];
  players(split: FactionSplit): readonly WhoPlayer[];
}

/** The listeners parked in each capital lend the watcher their /yell, so it can broadcast to
 *  everyone nearby in the city. See CityYellers for which listener's yell is used. */
export interface YellSink {
  /** The /yell into `faction`'s capital, or undefined when no listener there can yell right now. */
  yellFor(faction: Faction): ((message: string) => void) | undefined;
}

/** Chronicle early-confirm dependencies for a lane, or null when it's off (no Mongo / disabled). */
export interface LaneChronicle {
  readonly client: ChronicleClient;
  readonly store: ChronicleStore;
  readonly realm: string;
  /** How far a kill's pull time may sit from the raid's span and still count as this raid's. */
  readonly matchWindowMs: number;
}
