import { describe, expect, it, vi, type Mock } from "vitest";
import type { WhoResult } from "../protocol/who.js";
import type { WhoFn } from "./roster.js";
import { rotatingWho } from "./who-rotation.js";

const empty: WhoResult = { players: [], onlineCount: 0 };
const socket = (): Mock<WhoFn> => vi.fn<WhoFn>(async () => empty);

describe("rotatingWho", () => {
  it("sends each query on the next socket in turn", async () => {
    const a = socket();
    const b = socket();
    const who = rotatingWho(() => [a, b]);
    for (let i = 0; i < 3; i += 1) await who({ zoneIds: [1583] });
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ zoneIds: [1583] });
  });

  it("follows the sockets as they come and go", async () => {
    const a = socket();
    const b = socket();
    let sockets: WhoFn[] = [a];
    const who = rotatingWho(() => sockets);
    await who({});
    sockets = [b];
    await who({});
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("refuses rather than guess when no socket is free", async () => {
    await expect(rotatingWho(() => [])({})).rejects.toThrow("no socket free to /who on");
  });
});
