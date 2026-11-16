import { describe, expect, it, vi } from "vitest";
import {
  InMemoryRaidCounterStore,
  MongoRaidCounterStore,
  raiseCounterUpdate,
  type RaidCounterDb,
} from "./raid-counter-store.js";

describe("InMemoryRaidCounterStore", () => {
  it("starts at 0 and round-trips saved values", async () => {
    const store = new InMemoryRaidCounterStore();
    expect(await store.load()).toBe(0);
    await store.save(834);
    expect(await store.load()).toBe(834);
  });

  it("never lowers the value when an older save lands last", async () => {
    const store = new InMemoryRaidCounterStore(35);
    await Promise.all([store.save(37), store.save(36)]);
    expect(await store.load()).toBe(37);
  });

  it("accepts an initial value (for tests)", async () => {
    expect(await new InMemoryRaidCounterStore(41).load()).toBe(41);
  });
});

describe("MongoRaidCounterStore", () => {
  function fakeDb(): RaidCounterDb & { value: number | null } {
    const state = { value: null as number | null };
    return {
      get value() {
        return state.value;
      },
      get: vi.fn(async () => state.value),
      raise: vi.fn(async (v: number) => {
        state.value = Math.max(state.value ?? v, v);
      }),
      close: vi.fn(async () => {}),
    };
  }

  it("loads 0 when nothing is stored, then the saved value", async () => {
    const db = fakeDb();
    const store = new MongoRaidCounterStore(db);
    expect(await store.load()).toBe(0);
    await store.save(29);
    expect(db.value).toBe(29);
    expect(await store.load()).toBe(29);
  });

  it("raises the stored value on each save, so an older save landing last can't lower it", async () => {
    const db = fakeDb();
    const store = new MongoRaidCounterStore(db);
    await Promise.all([store.save(37), store.save(36)]);
    expect(db.raise).toHaveBeenNthCalledWith(1, 37);
    expect(db.raise).toHaveBeenNthCalledWith(2, 36);
    expect(await store.load()).toBe(37);
  });

  it("raises the Mongo document with $max, never overwriting it with $set", () => {
    expect(raiseCounterUpdate(37)).toEqual({ $max: { value: 37 } });
  });

  it("closes the underlying connection", async () => {
    const db = fakeDb();
    await new MongoRaidCounterStore(db).close();
    expect(db.close).toHaveBeenCalled();
  });
});
