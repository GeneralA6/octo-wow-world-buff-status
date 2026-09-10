import { describe, expect, it, vi } from "vitest";
import {
  InMemoryServerStatusWidgetStore,
  MongoServerStatusWidgetStore,
  docToState,
  stateToDoc,
  type ServerStatusWidgetDb,
  type ServerStatusWidgetState,
} from "./status-widget-store.js";

const sample: ServerStatusWidgetState = {
  messageId: "msg42",
  lastOutageEndedAt: 1_700_000_000_000,
  lastOutageDurationMs: 720_000,
};

describe("InMemoryServerStatusWidgetStore", () => {
  it("loads null on a fresh install", async () => {
    expect(await new InMemoryServerStatusWidgetStore().load()).toBeNull();
  });

  it("round-trips the saved state", async () => {
    const store = new InMemoryServerStatusWidgetStore();
    await store.save(sample);
    expect(await store.load()).toEqual(sample);
  });

  it("returns the initial state it was constructed with", async () => {
    expect(await new InMemoryServerStatusWidgetStore(sample).load()).toEqual(sample);
  });
});

describe("state <-> document mapping", () => {
  it("drops nothing on the round trip and never invents an _id", () => {
    const doc = stateToDoc(sample);
    expect(doc).toEqual({ messageId: "msg42", lastOutageEndedAt: 1_700_000_000_000, lastOutageDurationMs: 720_000 });
    expect("_id" in doc).toBe(false);
    expect(docToState({ _id: "status", ...doc })).toEqual(sample);
  });

  it("carries a fresh widget with no message yet", () => {
    const fresh: ServerStatusWidgetState = { messageId: null, lastOutageEndedAt: null, lastOutageDurationMs: null };
    expect(docToState({ _id: "status", ...stateToDoc(fresh) })).toEqual(fresh);
  });
});

describe("MongoServerStatusWidgetStore", () => {
  it("delegates load/save/close to its db port", async () => {
    const db: ServerStatusWidgetDb = {
      get: vi.fn().mockResolvedValue(sample),
      set: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const store = new MongoServerStatusWidgetStore(db);

    expect(await store.load()).toEqual(sample);
    await store.save(sample);
    await store.close();

    expect(db.get).toHaveBeenCalledOnce();
    expect(db.set).toHaveBeenCalledWith(sample);
    expect(db.close).toHaveBeenCalledOnce();
  });
});
