import { describe, expect, it } from "vitest";
import { ServerMonitor } from "./server-monitor.js";

const IDS = ["Bufftracker", "Onyxiabuffsw", "Onyxiabuffog"] as const;

describe("ServerMonitor", () => {
  it("declares the realm down only when EVERY connection is down, once", () => {
    const m = new ServerMonitor(IDS);
    expect(m.connectionDown("Bufftracker", 1_000)).toBe(false); // 1 of 3
    expect(m.connectionDown("Onyxiabuffsw", 2_000)).toBe(false); // 2 of 3
    expect(m.outageActive).toBe(false);
    expect(m.connectionDown("Onyxiabuffog", 3_000)).toBe(true); // 3 of 3 -> announce
    expect(m.outageActive).toBe(true);
  });

  it("does not re-announce when an already-down connection reports down again", () => {
    const m = new ServerMonitor(IDS);
    m.connectionDown("Bufftracker", 1_000);
    m.connectionDown("Onyxiabuffsw", 2_000);
    m.connectionDown("Onyxiabuffog", 3_000);
    // A repeat of one that is already counted must not fire a second outage.
    expect(m.connectionDown("Bufftracker", 4_000)).toBe(false);
  });

  it("announces recovery on the FIRST connection back, with the outage duration", () => {
    const m = new ServerMonitor(IDS);
    m.connectionDown("Bufftracker", 0);
    m.connectionDown("Onyxiabuffsw", 0);
    m.connectionDown("Onyxiabuffog", 60_000); // down since 60s
    expect(m.connectionUp("Onyxiabuffsw", 300_000)).toBe(240_000); // 300s - 60s
    expect(m.outageActive).toBe(false);
    // Later connections coming back do not re-announce.
    expect(m.connectionUp("Bufftracker", 320_000)).toBeNull();
    expect(m.connectionUp("Onyxiabuffog", 340_000)).toBeNull();
  });

  it("does not announce recovery when no outage was declared (partial down only)", () => {
    const m = new ServerMonitor(IDS);
    m.connectionDown("Bufftracker", 1_000); // only 1 of 3
    expect(m.connectionUp("Bufftracker", 2_000)).toBeNull();
    expect(m.outageActive).toBe(false);
  });

  it("a lone flaky connection cycling down/up never trips the realm signal", () => {
    const m = new ServerMonitor(IDS);
    for (let t = 0; t < 5; t++) {
      expect(m.connectionDown("Onyxiabuffsw", t * 1_000)).toBe(false);
      expect(m.connectionUp("Onyxiabuffsw", t * 1_000 + 500)).toBeNull();
    }
    expect(m.outageActive).toBe(false);
  });

  it("stays down through a chronically-dead character: the other two are the quorum", () => {
    const m = new ServerMonitor(IDS);
    m.connectionDown("Onyxiabuffog", 0); // dead the whole time
    // A real realm outage takes the other two down -> all three down -> announce. The outage clock
    // starts here, when the quorum completes (now = 20_000), not when the dead one first dropped.
    m.connectionDown("Bufftracker", 10_000);
    expect(m.connectionDown("Onyxiabuffsw", 20_000)).toBe(true);
    // The realm answers again: the first live character back ends the outage, even though the
    // dead one never recovers. Duration is measured from the quorum: 80_000 - 20_000.
    expect(m.connectionUp("Bufftracker", 80_000)).toBe(60_000);
    expect(m.outageActive).toBe(false);
  });

  it("can declare a second outage after a full recovery cycle", () => {
    const m = new ServerMonitor(IDS);
    for (const id of IDS) m.connectionDown(id, 0);
    // A full recovery: every connection gets a clean run back, only the first one announces.
    expect(m.connectionUp("Bufftracker", 100_000)).toBe(100_000);
    expect(m.connectionUp("Onyxiabuffsw", 101_000)).toBeNull();
    expect(m.connectionUp("Onyxiabuffog", 102_000)).toBeNull();
    expect(m.outageActive).toBe(false);
    // Second outage: all three down again -> announce again.
    m.connectionDown("Bufftracker", 200_000);
    m.connectionDown("Onyxiabuffsw", 200_000);
    expect(m.connectionDown("Onyxiabuffog", 200_000)).toBe(true);
    expect(m.outageActive).toBe(true);
  });

  it("ignores an unknown connection id (wiring guard) without affecting the quorum", () => {
    const m = new ServerMonitor(IDS);
    expect(m.connectionDown("Stranger", 1_000)).toBe(false);
    expect(m.connectionUp("Stranger", 2_000)).toBeNull();
    // The real three still form the quorum unaffected.
    m.connectionDown("Bufftracker", 3_000);
    m.connectionDown("Onyxiabuffsw", 3_000);
    expect(m.connectionDown("Onyxiabuffog", 3_000)).toBe(true);
  });

  it("degrades to watcher-only when there are no listeners", () => {
    const m = new ServerMonitor(["Bufftracker"]);
    expect(m.connectionDown("Bufftracker", 1_000)).toBe(true);
    expect(m.connectionUp("Bufftracker", 5_000)).toBe(4_000);
  });
});
