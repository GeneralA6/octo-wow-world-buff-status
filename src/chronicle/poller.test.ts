import { describe, expect, it } from "vitest";
import { silentLogger } from "../logger.js";
import { InMemorySnapshotStore } from "../watcher/snapshot-store.js";
import type { ChronicleClient } from "./client.js";
import { pollChronicleOnce } from "./poller.js";
import { InMemoryChronicleStore } from "./store.js";
import type { ChronicleLog } from "./types.js";

const WINDOW = 15 * 60_000;
const T = (iso: string): Date => new Date(iso);

function log(over: Partial<ChronicleLog> & { id: string }): ChronicleLog {
  return {
    realm_name: "N'Zoth",
    uploader_name: "Anaeri",
    guild_name: "Phoenix",
    first_encounter_time: "2026-09-01T02:05:00Z",
    player_count: 28,
    encounters: [{ name: "Onyxia", boss: true, kill_type: "clean" }],
    ...over,
  };
}

function clientOf(logs: ChronicleLog[]): ChronicleClient {
  return { fetchRecentOnyxia: async () => logs };
}

async function seededSnapshots(): Promise<InMemorySnapshotStore> {
  const snaps = new InMemorySnapshotStore();
  // We saw Anaeri's raid in the lair at ~02:00; we never saw Ghost.
  await snaps.record({ ts: T("2026-09-01T01:58:00Z"), present: 3, complete: true, names: ["Anaeri", "Zug", "Bob"] });
  await snaps.record({ ts: T("2026-09-01T02:02:00Z"), present: 3, complete: true, names: ["Anaeri", "Zug", "Bob"] });
  return snaps;
}

describe("pollChronicleOnce", () => {
  it("keeps only our realm's clean kills, confirms the ones we saw, flags the ones we missed", async () => {
    const logs = [
      log({ id: "seen", uploader_name: "Anaeri", first_encounter_time: "2026-09-01T02:05:00Z" }),
      log({ id: "missed", uploader_name: "Ghost", first_encounter_time: "2026-09-01T03:00:00Z" }),
      log({ id: "wipe", encounters: [{ name: "Onyxia", boss: true, kill_type: "wipe" }] }),
      log({ id: "other-realm", realm_name: "Y'Shaarj" }),
    ];
    const store = new InMemoryChronicleStore();
    const summary = await pollChronicleOnce({
      client: clientOf(logs),
      snapshots: await seededSnapshots(),
      store,
      realm: "N'Zoth",
      matchWindowMs: WINDOW,
      logger: silentLogger,
    });
    expect(summary).toMatchObject({ fetched: 2, fresh: 2, confirmed: 1, missed: 1, distinctMissedRaids: 1 });
    expect(await store.knownLogIds(["seen", "missed", "wipe", "other-realm"])).toEqual(new Set(["seen", "missed"]));
  });

  it("does nothing on a second poll of the same logs (dedup by logId)", async () => {
    const logs = [log({ id: "seen", uploader_name: "Anaeri" })];
    const store = new InMemoryChronicleStore();
    const deps = { client: clientOf(logs), snapshots: await seededSnapshots(), store, realm: "N'Zoth", matchWindowMs: WINDOW, logger: silentLogger };
    await pollChronicleOnce(deps);
    const second = await pollChronicleOnce(deps);
    expect(second).toMatchObject({ fetched: 1, fresh: 0, confirmed: 0, missed: 0 });
  });

  it("collapses several uploads of one raid but still confirms it once per log", async () => {
    // Three uploaders of the same 02:05 raid, all in our roster.
    const logs = [
      log({ id: "u1", uploader_name: "Anaeri" }),
      log({ id: "u2", uploader_name: "Zug" }),
      log({ id: "u3", uploader_name: "Bob" }),
    ];
    const summary = await pollChronicleOnce({
      client: clientOf(logs),
      snapshots: await seededSnapshots(),
      store: new InMemoryChronicleStore(),
      realm: "N'Zoth",
      matchWindowMs: WINDOW,
      logger: silentLogger,
    });
    expect(summary.fresh).toBe(3);
    expect(summary.confirmed).toBe(3); // each log confirmed
    expect(summary.missed).toBe(0);
  });
});
