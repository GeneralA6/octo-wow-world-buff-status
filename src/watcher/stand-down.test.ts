import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StandDown, type LogoutResult, type StandDownDeps } from "./stand-down.js";
import type { Threat } from "./threat-watch.js";

const INFERNAL: Threat = { kind: "infernal", guid: 0xf130_0000_5900_0abcn, owner: null, distance: 12 };
const RETRY_MS = 10_000;

function setup(results: readonly LogoutResult[], alive = true) {
  const queue = [...results];
  let living = alive;
  const deps = {
    isAlive: vi.fn(() => living),
    say: vi.fn<(line: string) => void>(),
    logout: vi.fn(async (): Promise<LogoutResult> => queue.shift() ?? "refused"),
    close: vi.fn<() => void>(),
    rearm: vi.fn<() => void>(),
    onLeft: vi.fn<StandDownDeps["onLeft"]>(),
    onCornered: vi.fn<StandDownDeps["onCornered"]>(),
  } satisfies StandDownDeps;
  const standDown = new StandDown(deps, { retryMs: RETRY_MS });
  return { standDown, deps, die: () => (living = false) };
}

describe("StandDown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says its parting line, logs out and leaves", async () => {
    const { standDown, deps } = setup(["logged-out"]);
    await standDown.face(INFERNAL, "Blink it is.");
    expect(deps.say).toHaveBeenCalledWith("Blink it is.");
    expect(deps.close).toHaveBeenCalledOnce();
    expect(deps.onLeft).toHaveBeenCalledWith(INFERNAL, "logged-out");
    expect(deps.onCornered).not.toHaveBeenCalled();
  });

  it("drops the connection when the logout goes unanswered", async () => {
    const { standDown, deps } = setup(["no-answer"]);
    await standDown.face(INFERNAL, "Blink it is.");
    expect(deps.close).toHaveBeenCalledOnce();
    expect(deps.onLeft).toHaveBeenCalledWith(INFERNAL, "no-answer");
  });

  it("stays connected when already in a fight, and tries again shortly", async () => {
    const { standDown, deps } = setup(["refused"]);
    await standDown.face(INFERNAL, "Blink it is.");
    expect(deps.close).not.toHaveBeenCalled();
    expect(deps.onLeft).not.toHaveBeenCalled();
    expect(deps.onCornered).toHaveBeenCalledWith(INFERNAL);
    expect(deps.rearm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RETRY_MS);
    expect(deps.rearm).toHaveBeenCalledOnce();
  });

  it("leaves once the fight is over, saying its line and raising the alarm only once", async () => {
    const { standDown, deps } = setup(["refused", "refused", "logged-out"]);
    await standDown.face(INFERNAL, "Blink it is.");
    await standDown.face(INFERNAL, "Blink it is.");
    await standDown.face(INFERNAL, "Blink it is.");
    expect(deps.say).toHaveBeenCalledOnce();
    expect(deps.onCornered).toHaveBeenCalledOnce();
    expect(deps.close).toHaveBeenCalledOnce();
    expect(deps.onLeft).toHaveBeenCalledWith(INFERNAL, "logged-out");
  });

  it("never logs out once dead — a resurrection needs it online", async () => {
    const { standDown, deps, die } = setup(["refused", "logged-out"]);
    await standDown.face(INFERNAL, "Blink it is.");
    die();
    await standDown.face(INFERNAL, "Blink it is.");
    expect(deps.logout).toHaveBeenCalledOnce();
    expect(deps.close).not.toHaveBeenCalled();
  });

  it("keeps watching while dead, in case it is brought back with the danger still near", async () => {
    const { standDown, deps } = setup([], false);
    await standDown.face(INFERNAL, "Blink it is.");
    expect(deps.logout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RETRY_MS);
    expect(deps.rearm).toHaveBeenCalledOnce();
  });

  it("asks only once at a time", async () => {
    const { standDown, deps } = setup(["logged-out"]);
    const first = standDown.face(INFERNAL, "Blink it is.");
    await standDown.face(INFERNAL, "Blink it is.");
    await first;
    expect(deps.logout).toHaveBeenCalledOnce();
  });

  it("retries nothing once the connection is over", async () => {
    const { standDown, deps } = setup(["refused"]);
    await standDown.face(INFERNAL, "Blink it is.");
    standDown.dispose();
    vi.advanceTimersByTime(RETRY_MS);
    expect(deps.rearm).not.toHaveBeenCalled();
  });
});
