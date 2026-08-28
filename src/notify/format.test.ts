import { describe, expect, it } from "vitest";
import type { WhoPlayer } from "../protocol/who.js";
import { formatEvent } from "./format.js";

function player(name: string, guild = "Fortitude"): WhoPlayer {
  return { name, guild, level: 60, classId: 1, raceId: 2, areaId: 2159 };
}

const AREA = "Onyxia's Lair";

describe("formatEvent", () => {
  it("phrases a fresh entry as incoming and names the dominant guild", () => {
    const message = formatEvent(
      { kind: "raid-entered", initial: false, players: [player("A"), player("B")] },
      AREA,
    );
    expect(message.kind).toBe("entered");
    expect(message.title).toBe("🐉 Raid entered Onyxia's Lair");
    expect(message.body).toContain("2 players");
    expect(message.body).toContain("<Fortitude>");
    expect(message.body).toContain("world buff");
  });

  it("phrases an initial in-progress raid differently", () => {
    const message = formatEvent(
      { kind: "raid-entered", initial: true, players: [player("A")] },
      AREA,
    );
    expect(message.title).toBe("🐉 Raid already in Onyxia's Lair");
    expect(message.body).toContain("1 player already inside");
  });

  it("phrases a clear with the previous count", () => {
    const message = formatEvent(
      { kind: "raid-left", previousPlayers: [player("A"), player("B"), player("C")] },
      AREA,
    );
    expect(message.kind).toBe("left");
    expect(message.title).toBe("✅ Onyxia's Lair cleared");
    expect(message.body).toContain("was 3 players");
  });

  it("summarizes a roster change with +/- counts", () => {
    const message = formatEvent(
      {
        kind: "roster-changed",
        entered: [player("C")],
        left: ["A"],
        players: [player("B"), player("C")],
      },
      AREA,
    );
    expect(message.kind).toBe("changed");
    expect(message.body).toContain("+1");
    expect(message.body).toContain("-1");
    expect(message.body).toContain("2 players now");
  });

  it("uses singular wording for one player and omits an empty guild", () => {
    const message = formatEvent(
      { kind: "raid-entered", initial: false, players: [player("Solo", "")] },
      AREA,
    );
    expect(message.body).toContain("1 player just appeared");
    expect(message.body).not.toContain("<>");
    expect(message.body).not.toContain("mostly");
  });
});
