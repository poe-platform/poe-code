import { afterEach, describe, expect, it, vi } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import { serializePlan } from "./serialize.js";

describe("plan coordination waiting feedback", () => {
  afterEach(() => vi.useRealTimers());

  it("reports contention once and remains cancellable without releasing the owner", async () => {
    vi.useFakeTimers();
    const fs = createFsFromVolume(Volume.fromJSON({ "/plan.lock": "existing-owner" })).promises;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const owner = serializePlan({ planPath: "/plan.md", kind: "run", operation: () => gate });
    const abort = new AbortController(); const onWait = vi.fn(); const operation = vi.fn();
    const pending = serializePlan({ planPath: "/plan.md", kind: "run", signal: abort.signal, onWait, operation });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const followerOperation = vi.fn(); let follower: Promise<unknown> | undefined;
    try {
      await vi.advanceTimersByTimeAsync(40);
      expect(onWait).toHaveBeenCalledExactlyOnceWith("/plan.md"); expect(operation).not.toHaveBeenCalled();
      abort.abort(); await rejected;
      follower = serializePlan({ planPath: "/plan.md", kind: "run", operation: followerOperation });
      await vi.advanceTimersByTimeAsync(40); expect(followerOperation).not.toHaveBeenCalled();
      expect(await fs.readFile("/plan.lock", "utf8")).toBe("existing-owner"); expect(vi.getTimerCount()).toBe(0);
    } finally { abort.abort(); release(); await Promise.allSettled([owner, pending, follower]); }
  });
});
