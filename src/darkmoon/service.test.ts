import { describe, expect, it, vi } from "vitest";
import { FaireService } from "./service.js";
import { VANILLA_SCHEDULE } from "./schedule.js";
import { InMemorySightingStore, type SightingStore } from "./sighting-store.js";
import type { FaireSighting } from "./resolve.js";

const utc = (iso: string): number => Date.parse(iso);
/** Mid-week of the Sept 2026 faire (7th-14th), which the shipped anchor calls Elwynn. */
const NOW = utc("2026-09-10T12:00:00Z");

const makeService = (
  store: SightingStore = new InMemorySightingStore(),
  onSighting?: (sighting: FaireSighting) => void,
): FaireService => new FaireService({ schedule: VANILLA_SCHEDULE, store, onSighting });

describe("FaireService.observe", () => {
  it("accepts a trusted broadcast and reports from it", async () => {
    const service = makeService();
    expect(await service.observe("PWB_DMF:10401:M-3600-Someplayer", NOW)).toBe(true);
    expect(service.sighting).toEqual({
      location: "mulgore",
      sightedAt: NOW - 3_600_000,
      witness: "Someplayer",
    });
    expect(service.report(NOW).location).toBe("mulgore");
    expect(service.report(NOW).source).toBe("sighting");
  });

  it("ignores the rest of the LFT channel's traffic", async () => {
    const service = makeService();
    expect(await service.observe("OB_INC:1:A-O-Someplayer-14-32", NOW)).toBe(false);
    expect(await service.observe("PWB:1337:A-O-13-37-Pizzahawaii", NOW)).toBe(false);
    expect(await service.observe("LFG Mara need healer", NOW)).toBe(false);
    expect(service.sighting).toBeNull();
  });

  it("ignores a broadcast from a version with the Carnie bug", async () => {
    const service = makeService();
    expect(await service.observe("PWB_DMF:10400:M-60-Someplayer", NOW)).toBe(false);
    expect(service.sighting).toBeNull();
  });

  it("ignores a sighting older than the faire's own visit", async () => {
    const service = makeService();
    const eightDays = 8 * 86_400;
    expect(await service.observe(`PWB_DMF:10401:M-${eightDays}-Someplayer`, NOW)).toBe(false);
    expect(service.sighting).toBeNull();
  });

  it("keeps the freshest sighting and writes nothing for the rebroadcast flood", async () => {
    const store = new InMemorySightingStore();
    const save = vi.spyOn(store, "save");
    const service = makeService(store);

    expect(await service.observe("PWB_DMF:10401:M-3600-First", NOW)).toBe(true);
    // Every other client repeats the same sighting, each with its own drift — none is newer.
    expect(await service.observe("PWB_DMF:10401:M-3600-First", NOW)).toBe(false);
    expect(await service.observe("PWB_DMF:10401:M-7200-Second", NOW)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);

    expect(await service.observe("PWB_DMF:10401:M-60-Third", NOW)).toBe(true);
    expect(service.sighting?.witness).toBe("Third");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("lets a newer sighting move the faire to the other zone", async () => {
    const service = makeService();
    await service.observe("PWB_DMF:10401:E-3600-First", NOW);
    await service.observe("PWB_DMF:10401:M-60-Second", NOW);
    expect(service.report(NOW).location).toBe("mulgore");
  });

  it("announces an accepted sighting exactly once", async () => {
    const onSighting = vi.fn();
    const service = makeService(new InMemorySightingStore(), onSighting);
    await service.observe("PWB_DMF:10401:M-3600-Someplayer", NOW);
    await service.observe("PWB_DMF:10401:M-3600-Someplayer", NOW);
    expect(onSighting).toHaveBeenCalledTimes(1);
    expect(onSighting).toHaveBeenCalledWith({
      location: "mulgore",
      sightedAt: NOW - 3_600_000,
      witness: "Someplayer",
    });
  });
});

describe("FaireService.load", () => {
  it("restores a sighting from a previous run, so the anchor survives a redeploy", async () => {
    const stored: FaireSighting = { location: "mulgore", sightedAt: NOW, witness: "Someplayer" };
    const service = makeService(new InMemorySightingStore(stored));
    await service.load();

    // A month later the sighting is far too old to be live, but it still owns the alternation.
    const october = service.report(utc("2026-10-06T12:00:00Z"));
    expect(october.location).toBe("elwynn");
    expect(october.source).toBe("calendar");
    expect(october.locationConfirmed).toBe(true);
  });

  it("falls back to the shipped calendar when nothing was ever stored", async () => {
    const service = makeService();
    await service.load();
    const report = service.report(NOW);
    expect(report.location).toBe("elwynn");
    expect(report.source).toBe("calendar");
    expect(report.locationConfirmed).toBe(false);
  });
});
