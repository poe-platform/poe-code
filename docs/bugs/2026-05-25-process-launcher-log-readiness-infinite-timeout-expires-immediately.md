# Process launcher log readiness infinite timeout expires immediately

## Summary

The exported `@poe-code/process-launcher` `waitForReady()` API accepts `timeoutMs: Number.POSITIVE_INFINITY` for a `log-pattern` readiness check. Instead of waiting indefinitely or rejecting the invalid non-finite timeout, it schedules an overflow-coerced timer and resolves `false` immediately before a service has any opportunity to emit its readiness line.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/health/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { waitForReady } from "./health-check.js";

describe("process-launcher non-finite log readiness timeout", () => {
  it("times out immediately when configured with Infinity", async () => {
    vi.useFakeTimers();
    try {
      const result = waitForReady(
        { kind: "log-pattern", pattern: "ready" },
        { timeoutMs: Number.POSITIVE_INFINITY }
      );

      await vi.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/health/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/health/__probe__.test.ts
```

## Observed Behavior

The readiness operation resolves as timed out after advancing only one millisecond, despite its caller requesting an infinite timeout:

```text
✓ packages/process-launcher/src/health/__probe__.test.ts > process-launcher non-finite log readiness timeout > times out immediately when configured with Infinity
```

`waitForReady()` is publicly exported from `packages/process-launcher/src/index.ts`. For `log-pattern` checks, `waitForLogPattern()` in `packages/process-launcher/src/health/health-check.ts` passes `options.timeoutMs ?? 30_000` directly to `setTimeout()`. Node does not treat `Infinity` as an unlimited timer duration; it coerces the overflowed delay to an immediate timer, causing `finish(false)` to run almost at once without validating or normalizing the caller's timeout value.

## Expected Behavior

Readiness helpers should require finite, valid timeout durations, or should explicitly define and implement `Infinity` as an unlimited wait. A caller requesting an unbounded readiness wait must not receive an immediate timeout result.

## Impact

Applications using the exported readiness helper, or supervisor integrations that surface the same timeout setting, can classify a starting service as not ready immediately after launch when configuration contains an infinite duration. This can trigger unnecessary process termination or restart behavior, mask healthy startup, and produce failures that contradict the configured timeout policy.
