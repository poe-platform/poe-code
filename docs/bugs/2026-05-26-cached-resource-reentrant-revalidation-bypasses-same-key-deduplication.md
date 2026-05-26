# Cached resource reentrant revalidation bypasses same-key deduplication

## Summary

The exported `@poe-code/cached-resource` `createRevalidator()` helper advertises same-key in-flight revalidation deduplication, but it invokes a refresh callback before it records that key as in flight. A synchronous retrigger from inside the first callback therefore starts a second refresh for the same cache key instead of being ignored.

## Reproduction

Create a disposable probe at `packages/cached-resource/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRevalidator } from "./background-revalidator.js";

describe("cached-resource reentrant revalidation", () => {
  it("runs a same-key refresh twice when the first callback retriggers synchronously", async () => {
    const revalidator = createRevalidator();
    let runs = 0;

    revalidator.trigger("models", async () => {
      runs += 1;
      revalidator.trigger("models", async () => {
        runs += 1;
      });
    });

    await revalidator.waitForRevalidation();

    expect(runs).toBe(2);
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm -f packages/cached-resource/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/cached-resource/src/__probe__.test.ts > cached-resource reentrant revalidation > runs a same-key refresh twice when the first callback retriggers synchronously
```

## Observed Behavior

`createRevalidator()` is publicly exported at `packages/cached-resource/src/index.ts:15` through `packages/cached-resource/src/index.ts:16`. Its `trigger()` method checks `inflight.has(key)` at `packages/cached-resource/src/background-revalidator.ts:10` through `packages/cached-resource/src/background-revalidator.ts:11`, but it immediately executes `revalidate()` at `packages/cached-resource/src/background-revalidator.ts:13` before storing the resulting promise at `packages/cached-resource/src/background-revalidator.ts:17`. Because an `async` callback begins executing synchronously until its first suspension point, the first callback can call `trigger("models", ...)` while the map still has no `"models"` entry. Both callbacks run for the same key despite the intended de-duplication check.

The stale-while-revalidate orchestrator uses this same helper for cache refreshes at `packages/cached-resource/src/cache-orchestrator.ts:36` through `packages/cached-resource/src/cache-orchestrator.ts:43`, so reentrant fetch or persistence integrations can enter the duplicate execution window during ordinary cache updates.

## Expected Behavior

Once revalidation for a key begins, any same-key trigger that occurs before the initial callback settles, including a synchronous reentrant trigger, should be ignored or should observe the existing in-flight operation. The in-flight marker must be installed before user-provided refresh logic can execute.

## Impact

Consumers using the exported revalidator directly, or integrations whose stale-cache refresh path synchronously retriggers cache work, can issue duplicate API fetches and duplicate persistence writes for one cache key. This defeats the documented coordination behavior, can waste rate-limited network requests, and can allow competing refresh results or side effects to race while callers believe only one revalidation is active.
