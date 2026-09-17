import { isTrustedBroadcast, parseDmfBroadcast, sightedAt } from "./pwb.js";
import { resolveFaire, type FaireReport, type FaireSighting } from "./resolve.js";
import type { FaireSchedule } from "./schedule.js";
import type { SightingStore } from "./sighting-store.js";

/**
 * Holds what the bot knows about the Darkmoon Faire: the newest sighting overheard on the LFT
 * channel, kept in memory for the answer path and in Mongo so a redeploy does not forget it.
 *
 * Every LFT line the watcher already receives is offered to `observe`; the ones that are not PWB
 * faire broadcasts cost a `startsWith`. Acceptance is PWB's own rule — freshest sighting wins —
 * so the bot and the addon every player runs never disagree about where the faire is.
 */

export interface FaireServiceDeps {
  readonly schedule: FaireSchedule;
  readonly store: SightingStore;
  /** Fired when a strictly newer sighting is accepted, so the caller can log it. */
  readonly onSighting?: (sighting: FaireSighting) => void;
}

export class FaireService {
  readonly #deps: FaireServiceDeps;
  #sighting: FaireSighting | null = null;

  constructor(deps: FaireServiceDeps) {
    this.#deps = deps;
  }

  /** Load the persisted sighting. Call once on boot, before the first answer. */
  async load(): Promise<void> {
    this.#sighting = await this.#deps.store.load();
  }

  /** The sighting currently held, for logging and tests. */
  get sighting(): FaireSighting | null {
    return this.#sighting;
  }

  /**
   * Offer a line heard on the LFT channel. Returns true when it became the newest sighting.
   *
   * A sighting is only replaced by a strictly newer one, so the constant rebroadcast traffic
   * (every client, every 10-60s, mostly repeating what we already hold) writes nothing.
   */
  async observe(text: string, receivedAt: number): Promise<boolean> {
    const broadcast = parseDmfBroadcast(text);
    if (broadcast === null || !isTrustedBroadcast(broadcast)) return false;

    const seenAt = sightedAt(broadcast, receivedAt);
    if (this.#sighting !== null && seenAt <= this.#sighting.sightedAt) return false;

    const sighting: FaireSighting = {
      location: broadcast.location,
      sightedAt: seenAt,
      witness: broadcast.witness,
    };
    this.#sighting = sighting;
    await this.#deps.store.save(sighting);
    this.#deps.onSighting?.(sighting);
    return true;
  }

  /** What to tell a player asking where the faire is. */
  report(now: number): FaireReport {
    return resolveFaire(this.#deps.schedule, this.#sighting, now);
  }
}
