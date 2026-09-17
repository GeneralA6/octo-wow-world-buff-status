import { describe, expect, it, vi } from "vitest";
import { buildFaireEmbed, DarkmoonWidget, type FaireChannel } from "./widget.js";
import { InMemoryDarkmoonWidgetStore } from "./widget-store.js";
import { FAIRE_SITES } from "./schedule.js";
import { silentLogger } from "../logger.js";
import type { FaireObservation, FaireReport } from "./resolve.js";

const utc = (iso: string): number => Date.parse(iso);
const NOW = utc("2026-09-10T12:00:00Z");

const seen = (at: number): FaireObservation => ({
  location: "elwynn",
  windowSetupAt: utc("2026-09-04T00:00:00Z"),
  observedAt: at,
  source: "sighting",
  witness: "Someplayer",
});

const report = (over: Partial<FaireReport> = {}): FaireReport => ({
  phase: "up",
  location: "elwynn",
  site: FAIRE_SITES.elwynn,
  setupAt: utc("2026-09-04T00:00:00Z"),
  opensAt: utc("2026-09-07T00:00:00Z"),
  closesAt: utc("2026-09-14T00:00:00Z"),
  source: "calendar",
  confirmedBy: "sighting",
  observation: null,
  ...over,
});

describe("buildFaireEmbed", () => {
  it("leads with where to go and how long is left", () => {
    const embed = buildFaireEmbed(report(), NOW);
    expect(embed.title).toBe("🎪 Darkmoon Faire");
    expect(embed.description).toContain("Elwynn Forest (south of Goldshire)");
    expect(embed.description).toContain("Open now");
    expect(embed.description).toContain("Closes in 3d12h");
  });

  it("dates the visit so a reader can plan, not just count down", () => {
    const embed = buildFaireEmbed(report(), NOW);
    expect(embed.fields?.[0]).toEqual({
      name: "This visit",
      value: "Mon 7 Sept – Sun 13 Sept",
      inline: true,
    });
  });

  it("says setting up rather than open, and colours it differently", () => {
    const setup = buildFaireEmbed(report({ phase: "setting-up" }), utc("2026-09-05T12:00:00Z"));
    expect(setup.description).toContain("not open for business yet");
    expect(setup.color).not.toBe(buildFaireEmbed(report(), NOW).color);
  });

  it("points at the next visit while travelling, including when the tents go up", () => {
    const embed = buildFaireEmbed(
      report({
        phase: "travelling",
        location: "mulgore",
        site: FAIRE_SITES.mulgore,
        setupAt: utc("2026-10-02T00:00:00Z"),
        opensAt: utc("2026-10-05T00:00:00Z"),
        closesAt: utc("2026-10-12T00:00:00Z"),
      }),
      NOW,
    );
    expect(embed.description).toContain("Travelling");
    expect(embed.description).toContain("Mulgore (below Thunder Bluff)");
    expect(embed.fields?.map((f) => f.name)).toEqual(["Next visit", "Tents go up"]);
    expect(embed.fields?.[1]?.value).toBe("Fri 2 Oct");
  });

  it("hedges in the body when nothing has confirmed the zone", () => {
    expect(buildFaireEmbed(report({ confirmedBy: null }), NOW).description).toContain("Should be open");
  });

  it("says in the footer where the answer came from", () => {
    expect(buildFaireEmbed(report({ confirmedBy: null }), NOW).footer?.text).toContain("not yet confirmed");
    expect(buildFaireEmbed(report({ confirmedBy: "herald" }), NOW).footer?.text).toContain("herald");
    expect(buildFaireEmbed(report({ source: "onsite" }), NOW).footer?.text).toContain("our own character");
  });

  it("dates the sighting when there is no window to quote", () => {
    const embed = buildFaireEmbed(
      report({ source: "sighting", closesAt: null, opensAt: null, observation: seen(NOW - 7_200_000) }),
      NOW,
    );
    expect(embed.description).toContain("Last seen 2h ago");
  });
});

describe("DarkmoonWidget", () => {
  function harness(initialMessageId: string | null = null) {
    const created: unknown[] = [];
    const edits: { messageId: string }[] = [];
    let nextId = "msg-1";
    let failEditWith: { kind: "unreachable" | "error"; status?: number } | null = null;
    const channel: FaireChannel = {
      create: vi.fn(async (message) => {
        created.push(message);
        return { ok: true as const, messageId: nextId };
      }),
      edit: vi.fn(async (messageId) => {
        if (failEditWith) return { ok: false as const, ...failEditWith };
        edits.push({ messageId });
        return { ok: true as const };
      }),
    };
    const store = new InMemoryDarkmoonWidgetStore(
      initialMessageId === null ? null : { messageId: initialMessageId },
    );
    let now = NOW;
    let current = report();
    const widget = new DarkmoonWidget({
      channel,
      store,
      report: () => current,
      now: () => now,
      logger: silentLogger,
    });
    return {
      widget,
      channel,
      store,
      created,
      edits,
      setReport: (next: FaireReport) => {
        current = next;
      },
      setNow: (at: number) => {
        now = at;
      },
      setNextId: (id: string) => {
        nextId = id;
      },
      failEdit: (failure: { kind: "unreachable" | "error"; status?: number } | null) => {
        failEditWith = failure;
      },
    };
  }

  it("posts the board once, then edits that same message", async () => {
    const h = harness();
    await h.widget.refresh();
    expect(h.created).toHaveLength(1);

    h.setReport(report({ phase: "travelling" }));
    await h.widget.refresh();
    expect(h.created).toHaveLength(1);
    expect(h.edits).toEqual([{ messageId: "msg-1" }]);
  });

  it("keeps editing the same message after a restart", async () => {
    const h = harness("msg-from-last-deploy");
    await h.widget.load();
    await h.widget.refresh();
    expect(h.created).toHaveLength(0);
    expect(h.edits).toEqual([{ messageId: "msg-from-last-deploy" }]);
  });

  it("does not touch Discord when nothing about the answer changed", async () => {
    const h = harness();
    await h.widget.refresh();
    // The timer keeps firing; nothing about the answer has changed since the last render.
    for (let i = 1; i <= 20; i += 1) await h.widget.refresh();
    expect(h.created).toHaveLength(1);
    expect(h.edits).toHaveLength(0);
  });

  it("edits as soon as the countdown text actually moves", async () => {
    const h = harness();
    await h.widget.refresh();
    h.setNow(NOW + 3_600_000); // "3d12h" -> "3d11h"
    await h.widget.refresh();
    expect(h.edits).toHaveLength(1);
  });

  it("reposts the board if someone deleted the message", async () => {
    const h = harness();
    await h.widget.refresh();
    h.setReport(report({ phase: "travelling" }));
    h.failEdit({ kind: "unreachable", status: 404 });
    h.setNextId("msg-2");
    await h.widget.refresh();
    expect(h.created).toHaveLength(2);
    expect(await h.store.load()).toEqual({ messageId: "msg-2" });
  });

  it("keeps its message id on an ordinary edit failure, rather than posting a duplicate", async () => {
    const h = harness();
    await h.widget.refresh();
    h.setReport(report({ phase: "travelling" }));
    h.failEdit({ kind: "error", status: 500 });
    await h.widget.refresh();
    expect(h.created).toHaveLength(1);
  });

  it("persists the message id the first time it posts", async () => {
    const h = harness();
    await h.widget.refresh();
    expect(await h.store.load()).toEqual({ messageId: "msg-1" });
  });
});
