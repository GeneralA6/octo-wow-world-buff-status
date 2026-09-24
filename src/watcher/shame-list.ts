import type { CharacterDetails } from "./character.js";
import type { ShamedPlayer, ShameListStore } from "./shame-list-store.js";

/**
 * Every player who has killed a bot listener — the players the bot no longer deals with — and, once
 * a /who has seen them, their race and class.
 *
 * The whisper commands ask `has` on every message, so the list is held in memory and read without
 * waiting; it is loaded once on boot and saved on each change. Names are matched regardless of
 * case, like subscribers are, and kept in the order each player first killed a listener.
 */
export class ShameList {
  readonly #store: ShameListStore;
  /** By name key, in the order each player was added. */
  readonly #players = new Map<string, ShamedPlayer>();
  /** Saves run one after another, so an older list can never land after a newer one. */
  #saves: Promise<void> = Promise.resolve();

  constructor(store: ShameListStore) {
    this.#store = store;
  }

  /** Load the players. Call once on boot, before anyone's whisper is answered. */
  async load(): Promise<void> {
    for (const player of await this.#store.load()) {
      if (!this.#players.has(keyOf(player.name))) this.#players.set(keyOf(player.name), player);
    }
  }

  /** Whether a player is on the list. */
  has(name: string): boolean {
    return this.#players.has(keyOf(name));
  }

  /** The players, in the order they first killed a listener. */
  get players(): readonly ShamedPlayer[] {
    return [...this.#players.values()];
  }

  /** The listed players whose race and class are still unknown. */
  get undescribed(): readonly string[] {
    return this.players.filter((player) => player.details === null).map((player) => player.name);
  }

  /**
   * Put a player on the list. True when they were not on it already. The player counts as listed
   * from this call on, even while the save is still in flight, or if it fails.
   */
  add(name: string): Promise<boolean> {
    const key = keyOf(name);
    if (this.#players.has(key)) return Promise.resolve(false);
    this.#players.set(key, { name, details: null });
    return this.#save().then(() => true);
  }

  /** Record a listed player's race and class. True when that changed what the list says. */
  describe(name: string, details: CharacterDetails): Promise<boolean> {
    const key = keyOf(name);
    const player = this.#players.get(key);
    if (!player || (player.details?.raceId === details.raceId && player.details.classId === details.classId)) {
      return Promise.resolve(false);
    }
    this.#players.set(key, { name: player.name, details });
    return this.#save().then(() => true);
  }

  #save(): Promise<void> {
    const snapshot = this.players;
    const saved = this.#saves.then(() => this.#store.save(snapshot));
    this.#saves = saved.catch(() => undefined);
    return saved;
  }
}

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}
