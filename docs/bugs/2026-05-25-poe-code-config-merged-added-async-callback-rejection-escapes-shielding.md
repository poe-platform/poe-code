# Poe Code Config merged added async callback rejection escapes shielding

## Summary

The exported `@poe-code/poe-code-config` callback merge helpers are designed to preserve user callbacks while isolating failures from additional integration callbacks. Their wrapper catches only synchronous throws from an added callback; if that callback is asynchronous and returns a rejected promise, the rejection is neither awaited nor warned about, escaping the promised failure shielding.

## Reproduction

Create the following disposable probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mergePipelineCallbacks } from "./merge-callbacks.js";

describe("mergePipelineCallbacks async added failure", () => {
  it("does not shield a rejected added callback promise", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const added = vi.fn(async () => {
      throw new Error("integration callback rejected");
    });
    const merged = mergePipelineCallbacks(
      { onPlanResolved: () => "user-result" as never },
      { onPlanResolved: added }
    );

    expect(merged?.onPlanResolved?.({})).toBe("user-result");
    const rejectedPromise = added.mock.results[0]?.value as Promise<void>;
    await expect(rejectedPromise).rejects.toThrow("integration callback rejected");
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm packages/poe-code-config/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > mergePipelineCallbacks async added failure > does not shield a rejected added callback promise
```

## Observed Behavior

`packages/poe-code-config/src/index.ts` exports `mergePipelineCallbacks()`, `mergeExperimentCallbacks()`, and `mergeLoopCallbacks()`. All three call the same `mergeCallbacks()` implementation in `packages/poe-code-config/src/merge-callbacks.ts`. When both user and added callbacks exist, the wrapper calls `addedCallback.apply(...)` inside a synchronous `try`/`catch` but does not inspect or await its return value. In the probe, a merged added asynchronous callback returns a rejected promise, the merged callback immediately returns the user result, and the configured `console.warn` shielding path is never reached.

## Expected Behavior

If the merge helpers intend added integration failures not to affect the primary callback path, they should also handle rejected promises returned by asynchronous added callbacks, for example by observing and warning on asynchronous failure without allowing an unhandled rejection.

## Impact

An integration callback implemented asynchronously can fail after a pipeline, experiment, or loop progress event while bypassing the configured warning/isolation behavior. Since callers generally invoke these `void` callback fields without awaiting return values, the escaped rejection can become an unhandled process error or silently lose integration diagnostics during an otherwise successful workflow.
