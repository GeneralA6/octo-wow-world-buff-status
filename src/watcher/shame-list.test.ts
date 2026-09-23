import { describe, expect, it, vi } from "vitest";
import { ShameList } from "./shame-list.js";
import { InMemoryShameListStore, type ShameListStore } from "./shame-list-store.js";

describe("ShameList", () => {
  it("knows the players saved by an earlier run", async () => {
    const list = new ShameList(new InMemoryShameListStore(["Ganker"]));
    await list.load();
    expect(list.has("Ganker")).toBe(true);
    expect(list.has("Raider")).toBe(false);
  });

  it("matches a player whatever the case", async () => {
    const list = new ShameList(new InMemoryShameListStore(["Ganker"]));
    await list.load();
    expect(list.has("ganker")).toBe(true);
    expect(list.has(" GANKER ")).toBe(true);
  });

  it("adds a player once, in the order they first killed, and saves the list", async () => {
    const store = new InMemoryShameListStore();
    const list = new ShameList(store);
    await list.load();
    expect(await list.add("Ganker")).toBe(true);
    expect(await list.add("Warlockz")).toBe(true);
    expect(await list.add("GANKER")).toBe(false);
    expect(list.names).toEqual(["Ganker", "Warlockz"]);
    expect(await store.load()).toEqual(["Ganker", "Warlockz"]);
  });

  it("lists a player at once, before the save lands", async () => {
    const list = new ShameList(new InMemoryShameListStore());
    const adding = list.add("Ganker");
    expect(list.has("Ganker")).toBe(true);
    await adding;
  });

  it("saves in order, so a later list is never overwritten by an earlier one", async () => {
    const saved: (readonly string[])[] = [];
    let release: () => void = () => {};
    const firstSaveHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      load: vi.fn(async (): Promise<readonly string[]> => []),
      save: vi.fn(async (names: readonly string[]) => {
        if (saved.length === 0) await firstSaveHeld;
        saved.push(names);
      }),
      close: vi.fn(async () => undefined),
    } satisfies ShameListStore;
    const list = new ShameList(store);

    const first = list.add("Ganker");
    const second = list.add("Warlockz");
    release();
    await Promise.all([first, second]);
    expect(saved).toEqual([["Ganker"], ["Ganker", "Warlockz"]]);
  });

  it("keeps the player listed when the save fails, and reports the failure", async () => {
    const store = {
      load: vi.fn(async (): Promise<readonly string[]> => []),
      save: vi.fn(async () => {
        throw new Error("mongo down");
      }),
      close: vi.fn(async () => undefined),
    } satisfies ShameListStore;
    const list = new ShameList(store);
    await expect(list.add("Ganker")).rejects.toThrow("mongo down");
    expect(list.has("Ganker")).toBe(true);
  });
});
