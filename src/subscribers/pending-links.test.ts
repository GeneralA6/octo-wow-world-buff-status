import { describe, expect, it } from "vitest";
import { PendingLinks } from "./pending-links.js";

/** A deterministic code generator that hands out the given codes in order. */
function codes(...seq: string[]): () => string {
  let i = 0;
  return () => seq[i++ % seq.length] ?? "ZZZZZZ";
}

describe("PendingLinks", () => {
  it("creates a code and resolves it to the (lowercased) character", () => {
    const links = new PendingLinks({ generate: codes("ABC123") });
    const code = links.create("Raider");
    expect(code).toBe("ABC123");
    expect(links.resolve("ABC123")).toMatchObject({ character: "raider", discordId: null });
  });

  it("carries a discordId for flow B", () => {
    const links = new PendingLinks({ generate: codes("ABC123") });
    links.create("Raider", "123456789012345678");
    expect(links.resolve("ABC123")?.discordId).toBe("123456789012345678");
  });

  it("resolves case-insensitively and consumes on remove", () => {
    const links = new PendingLinks({ generate: codes("ABC123") });
    links.create("Raider");
    expect(links.resolve("abc123")).not.toBeNull();
    links.remove("abc123");
    expect(links.resolve("ABC123")).toBeNull();
  });

  it("expires a code after its TTL", () => {
    let t = 1000;
    const links = new PendingLinks({ ttlMs: 500, now: () => t, generate: codes("ABC123") });
    links.create("Raider");
    t = 1400;
    expect(links.resolve("ABC123")).not.toBeNull();
    t = 1600;
    expect(links.resolve("ABC123")).toBeNull();
    expect(links.size).toBe(0);
  });

  it("replaces a character's prior pending code", () => {
    const links = new PendingLinks({ generate: codes("CODE01", "CODE02") });
    const first = links.create("Raider");
    const second = links.create("Raider");
    expect(first).not.toBe(second);
    expect(links.resolve(first)).toBeNull(); // superseded
    expect(links.resolve(second)).not.toBeNull();
    expect(links.size).toBe(1);
  });

  it("regenerates on a code collision", () => {
    const links = new PendingLinks({ generate: codes("DUP", "DUP", "UNIQUE") });
    links.create("Alice"); // takes DUP
    const bob = links.create("Bob"); // DUP taken -> regenerates to UNIQUE
    expect(bob).toBe("UNIQUE");
  });
});
