# Cached resource wait for revalidation resolves before nested refresh completes

## Summary

The exported `@poe-code/cached-resource` `createRevalidator().waitForRevalidation()` method is intended to wait for background refresh work, but its all-keys form awaits only the promises present when the method is called. If an in-flight refresh triggers another key while the wait is underway, the wait resolves even though the newly started background refresh is still running.

## Reproduction

Create this disposable Vitest probe at `packages/cached-resource/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createRevalidator } from "./background-revalidator.js";

describe("cached-resource revalidation drain", () => {
  it("resolves the all-keys wait before refresh work spawned during that wait completes", async () => {
    const revalidator = createRevalidator();
    let releaseParent!: () => void;
    let resolveNested!: () => void;
    const parentGate = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });
    const nested = vi.fn(() => new Promise<void>((resolve) => {
      resolveNested = resolve;
    }));

    revalidator.trigger("first", async () => {
      await parentGate;
      revalidator.trigger("nested", nested);
    });

    const waiting = revalidator.waitForRevalidation();
    releaseParent();
    await waiting;

    expect(nested).toHaveBeenCalledOnce();
    let nestedFinished = false;
    void revalidator.waitForRevalidation("nested").then(() => {
      nestedFinished = true;
    });
    await Promise.resolve();
    expect(nestedFinished).toBe(false);

    resolveNested();
    await revalidator.waitForRevalidation("nested");
  });
});
```

Run the focused probe and remove it afterward:

```sh
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm -f packages/cached-resource/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/cached-resource/src/__probe__.test.ts > cached-resource revalidation drain > resolves the all-keys wait before refresh work spawned during that wait completes
```

## Observed Behavior

The first refresh remains in flight when `waitForRevalidation()` starts. After that wait has captured the current work, completing the first refresh triggers a new `nested` refresh that remains blocked. Nevertheless, the original all-keys wait resolves. A separate `waitForRevalidation("nested")` is still pending until the nested callback is explicitly released.

`createRevalidator()` stores active promises in `inflight` at `packages/cached-resource/src/background-revalidator.ts:6` through `packages/cached-resource/src/background-revalidator.ts:18`. Its all-keys waiting branch performs a single `Promise.all(inflight.values())` at `packages/cached-resource/src/background-revalidator.ts:20` through `packages/cached-resource/src/background-revalidator.ts:25`. `Map.prototype.values()` is consumed to form that initial promise collection; it is not revisited for refresh work added after waiting begins, so the method does not drain transitive background activity.

This differs from `docs/bugs/2026-05-26-cached-resource-reentrant-revalidation-bypasses-same-key-deduplication.md`: that report covers starting duplicate same-key work before the key is recorded, while this issue uses different keys and shows the public drain API resolving too early after nested work is legitimately registered.

## Expected Behavior

Calling the all-keys `waitForRevalidation()` should not report background revalidation as drained while refresh jobs started by already-in-flight refreshes are still active. It should continue waiting until no tracked revalidation remains, or document and expose a narrower snapshot-only contract that callers cannot mistake for complete quiescence.

## Impact

Tests, shutdown flows, cache-clearing coordination, and callers attempting to wait for background synchronization can proceed while additional network fetches or cache writes are still running. This creates races where callers observe stale state, clear a cache only for it to be repopulated afterward, or tear down resources while refresh activity remains active despite a completed wait.
