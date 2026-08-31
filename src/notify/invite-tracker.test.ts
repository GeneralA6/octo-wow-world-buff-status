import { describe, expect, it } from "vitest";
import { InviteLinks, useCounts, whichInviteUsed } from "./invite-tracker.js";

describe("whichInviteUsed", () => {
  it("finds the invite whose use-count went up", () => {
    const before = useCounts([
      { code: "aaa", uses: 0 },
      { code: "bbb", uses: 3 },
    ]);
    const after = [
      { code: "aaa", uses: 0 },
      { code: "bbb", uses: 4 },
    ];
    expect(whichInviteUsed(before, after)).toBe("bbb");
  });

  it("treats a single-use invite that vanished as the one used", () => {
    const before = useCounts([
      { code: "aaa", uses: 0 },
      { code: "gone", uses: 0 },
    ]);
    const after = [{ code: "aaa", uses: 0 }]; // "gone" hit max_uses=1 and was deleted
    expect(whichInviteUsed(before, after)).toBe("gone");
  });

  it("returns null when nothing changed", () => {
    const before = useCounts([{ code: "aaa", uses: 2 }]);
    expect(whichInviteUsed(before, [{ code: "aaa", uses: 2 }])).toBeNull();
  });

  it("returns null when two invites changed at once (ambiguous)", () => {
    const before = useCounts([
      { code: "aaa", uses: 0 },
      { code: "bbb", uses: 0 },
    ]);
    const after = [
      { code: "aaa", uses: 1 },
      { code: "bbb", uses: 1 },
    ];
    expect(whichInviteUsed(before, after)).toBeNull();
  });

  it("counts a brand-new invite's first use", () => {
    const before = useCounts([{ code: "aaa", uses: 0 }]);
    const after = [
      { code: "aaa", uses: 0 },
      { code: "new", uses: 1 },
    ];
    expect(whichInviteUsed(before, after)).toBe("new");
  });
});

describe("InviteLinks", () => {
  it("maps a code to a character and takes it once", () => {
    const links = new InviteLinks();
    links.set("abc", "Gibom");
    expect(links.codeFor("Gibom")).toBe("abc");
    expect(links.take("abc")).toBe("Gibom");
    expect(links.take("abc")).toBeNull(); // consumed
    expect(links.size).toBe(0);
  });

  it("drops a character's previous code when a new one is minted", () => {
    const links = new InviteLinks();
    links.set("old", "Gibom");
    links.set("new", "Gibom");
    expect(links.take("old")).toBeNull(); // superseded
    expect(links.take("new")).toBe("Gibom");
  });

  it("returns null for an unknown code", () => {
    expect(new InviteLinks().take("nope")).toBeNull();
  });
});
