import { afterEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import { withPlanLock } from "./lock.js";

describe("plan lock waiting feedback", () => {
  afterEach(() => vi.useRealTimers());

  it("reports contention once and remains cancellable without changing the owner's lock", async () => {
    vi.useFakeTimers();
    const fs = createFsFromVolume(Volume.fromJSON({ "/plan.lock": "existing-owner" })).promises;
    const abort = new AbortController();
    const onWait = vi.fn();
    const operation = vi.fn();
    const pending = withPlanLock({
      fs, planPath: "/plan.md", lockPath: "/plan.lock", kind: "run",
      signal: abort.signal, onWait, operation
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(40);
    expect(onWait).toHaveBeenCalledExactlyOnceWith("/plan.md");
    expect(operation).not.toHaveBeenCalled();
    abort.abort();
    await rejected;
    expect(await fs.readFile("/plan.lock", "utf8")).toBe("existing-owner");
    expect(vi.getTimerCount()).toBe(0);
  });
});
