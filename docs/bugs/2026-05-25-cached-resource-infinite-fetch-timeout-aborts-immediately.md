# Cached resource infinite fetch timeout aborts immediately

## Summary

The exported `@poe-code/cached-resource` helper `fetchFromApi()` accepts `fetchTimeout: Infinity` as a public numeric configuration value, but passes it directly to Node's `setTimeout()`. Instead of permitting an unbounded request, Node clamps the unsupported timeout to `1ms`, emits a `TimeoutOverflowWarning`, and the helper reports that the request timed out almost immediately.

## Reproduction

Create a disposable Vitest probe at `packages/cached-resource/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fetchFromApi } from "./api-fetch.js";

describe("cached-resource infinite fetchTimeout", () => {
  it("aborts immediately instead of permitting an unbounded request", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(`${warning.name}: ${warning.message}`);
    process.on("warning", onWarning);

    try {
      const startedAt = Date.now();
      const outcome = await fetchFromApi(
        { apiEndpoint: "https://example.test/data", fetchTimeout: Infinity },
        {
          fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
        },
      ).then(
        () => ({ resolved: true as const }),
        (error: Error) => ({ rejected: error.message, elapsed: Date.now() - startedAt }),
      );

      console.log(JSON.stringify({ outcome, warnings }));
      expect(outcome).toMatchObject({
        rejected: "Request timed out after Infinityms",
      });
      expect("elapsed" in outcome && outcome.elapsed).toBeLessThan(100);
    } finally {
      process.off("warning", onWarning);
    }
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/cached-resource/src/__probe__.test.ts --reporter verbose
rm -f packages/cached-resource/src/__probe__.test.ts
```

The probe prints:

```text
(node:59920) TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
{"outcome":{"rejected":"Request timed out after Infinityms","elapsed":2},"warnings":["TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.\nTimeout duration was set to 1."]}
✓ packages/cached-resource/src/__probe__.test.ts > cached-resource infinite fetchTimeout > aborts immediately instead of permitting an unbounded request
```

## Observed Behavior

`packages/cached-resource/src/index.ts` exports `fetchFromApi()`, and the package README specifies `fetchTimeout` only as a numeric timeout in milliseconds. In `packages/cached-resource/src/api-fetch.ts`, `fetchFromApi()` constructs its abort timer using `setTimeout(() => controller.abort(), config.fetchTimeout)` without validating that the supplied numeric timeout is finite and supported by Node timers. With `Infinity`, Node changes the timer duration to `1ms`; the request is aborted after approximately `2ms` and rejects as `Request timed out after Infinityms`.

## Expected Behavior

The API should reject unsupported non-finite timeout configuration explicitly, or represent an intentional no-timeout mode without scheduling a clamped `1ms` timer. Supplying `Infinity` must not silently convert an unbounded wait into an almost immediate timeout.

## Impact

Applications can reasonably forward a no-deadline numeric setting into `fetchTimeout` and unexpectedly fail every network-backed cache request immediately. The misleading `Infinityms` diagnostic and Node warning make the configuration appear honored even though the effective request lifetime is only about one millisecond, causing avoidable cache misses and service failures.
