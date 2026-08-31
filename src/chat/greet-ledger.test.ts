import { describe, expect, it, vi } from "vitest";
import { InMemoryGreetLedger, MongoGreetLedger, type GreetDb } from "./greet-ledger.js";

describe("InMemoryGreetLedger", () => {
  it("claims a name once, then reports it already greeted (case-insensitively)", async () => {
    const ledger = new InMemoryGreetLedger();
    expect(await ledger.claim("Raider")).toBe(true);
    expect(await ledger.claim("raider")).toBe(false);
    expect(await ledger.claim("RAIDER")).toBe(false);
  });

  it("ignores blank names", async () => {
    const ledger = new InMemoryGreetLedger();
    expect(await ledger.claim("   ")).toBe(false);
  });
});

describe("MongoGreetLedger", () => {
  /** A fake GreetDb backed by a Set, honouring insert-if-absent semantics. */
  function fakeDb(): GreetDb & { ids: Set<string> } {
    const ids = new Set<string>();
    return {
      ids,
      insertIfAbsent: vi.fn(async (doc) => {
        if (ids.has(doc._id)) return false;
        ids.add(doc._id);
        return true;
      }),
      close: vi.fn(async () => {}),
    };
  }

  it("maps a first claim to true and a repeat to false, keyed case-insensitively", async () => {
    const db = fakeDb();
    const ledger = new MongoGreetLedger(db);
    expect(await ledger.claim("Raider")).toBe(true);
    expect(await ledger.claim("raider")).toBe(false);
    expect(db.ids.has("raider")).toBe(true);
  });

  it("stores the display name and a timestamp under the lowercased id", async () => {
    const db = fakeDb();
    await new MongoGreetLedger(db).claim("RaIdEr");
    expect(db.insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "raider", name: "RaIdEr", greetedAt: expect.any(Date) }),
    );
  });

  it("closes the underlying connection", async () => {
    const db = fakeDb();
    await new MongoGreetLedger(db).close();
    expect(db.close).toHaveBeenCalled();
  });
});
