import type { ShameListStore } from "./shame-list-store.js";

/**
 * Every player who has killed a bot listener — the players the bot no longer deals with.
 *
 * The whisper commands ask `has` on every message, so the list is held in memory and read without
 * waiting; it is loaded once on boot and saved on each addition. Names are matched regardless of
 * case, like subscribers are, and kept in the order each player first killed a listener.
 */
export class ShameList {
  readonly #store: ShameListStore;
  readonly #names: string[] = [];
  readonly #keys = new Set<string>();
  /** Saves run one after another, so an older list can never land after a newer one. */
  #saves: Promise<void> = Promise.resolve();

  constructor(store: ShameListStore) {
    this.#store = store;
  }

  /** Load the players. Call once on boot, before anyone's whisper is answered. */
  async load(): Promise<void> {
    for (const name of await this.#store.load()) this.#remember(name);
  }

  /** Whether a player is on the list. */
  has(name: string): boolean {
    return this.#keys.has(keyOf(name));
  }

  /** The players, in the order they first killed a listener. */
  get names(): readonly string[] {
    return [...this.#names];
  }

  /**
   * Put a player on the list. True when they were not on it already. The player counts as listed
   * from this call on, even while the save is still in flight, or if it fails.
   */
  add(name: string): Promise<boolean> {
    if (!this.#remember(name)) return Promise.resolve(false);
    const snapshot = [...this.#names];
    const saved = this.#saves.then(() => this.#store.save(snapshot));
    this.#saves = saved.catch(() => undefined);
    return saved.then(() => true);
  }

  #remember(name: string): boolean {
    const key = keyOf(name);
    if (this.#keys.has(key)) return false;
    this.#keys.add(key);
    this.#names.push(name);
    return true;
  }
}

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}
