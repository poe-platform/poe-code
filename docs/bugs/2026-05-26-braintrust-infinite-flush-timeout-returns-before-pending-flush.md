# Braintrust infinite flush timeout returns before pending flush

## Summary

The public `@poe-code/braintrust` client accepts `Infinity` as the `timeoutMs` argument to `flush()`. Rather than waiting indefinitely for pending telemetry writes, it forwards that non-finite value to `setTimeout()`, which Node reduces to approximately one millisecond; `flush()` then resolves while its Braintrust SDK flush promise remains unsettled.

## Reproduction

From the repository root, create and run this disposable probe, then remove it:

```ts
import { describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

const sdk = vi.hoisted(() => ({
  initLogger: vi.fn(() => ({ id: "root" })),
  flush: vi.fn(() => new Promise<void>(() => undefined)),
}));
vi.mock("braintrust", () => sdk);

describe("Braintrust flush timeout bounds", () => {
  it("returns almost immediately for an infinite timeout while flush remains pending", async () => {
    const client = createClient({ apiKey: "key", project: "project" });
    await client.getRootLogger();
    const started = Date.now();

    await client.flush(Number.POSITIVE_INFINITY);

    expect(Date.now() - started).toBeLessThan(100);
    expect(sdk.flush).toHaveBeenCalledTimes(1);
  });
});
```

```sh
cat > packages/braintrust/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

const sdk = vi.hoisted(() => ({
  initLogger: vi.fn(() => ({ id: "root" })),
  flush: vi.fn(() => new Promise<void>(() => undefined)),
}));
vi.mock("braintrust", () => sdk);

describe("Braintrust flush timeout bounds", () => {
  it("returns almost immediately for an infinite timeout while flush remains pending", async () => {
    const client = createClient({ apiKey: "key", project: "project" });
    await client.getRootLogger();
    const started = Date.now();

    await client.flush(Number.POSITIVE_INFINITY);

    expect(Date.now() - started).toBeLessThan(100);
    expect(sdk.flush).toHaveBeenCalledTimes(1);
  });
});
EOF
npm exec -- vitest run packages/braintrust/src/__probe__.test.ts --reporter verbose
rm packages/braintrust/src/__probe__.test.ts
```

The probe passes and Node reports that the infinite timer was shortened:

```text
(node:...) TimeoutOverflowWarning: Infinity does not fit into a 32-bit signed integer.
Timeout duration was set to 1.
✓ packages/braintrust/src/__probe__.test.ts > Braintrust flush timeout bounds > returns almost immediately for an infinite timeout while flush remains pending
```

## Observed Behavior

`createClient()` exposes its `flush(timeoutMs)` method through the exported Braintrust integration APIs. In `packages/braintrust/src/client.ts:88` through `packages/braintrust/src/client.ts:118`, `flush()` races SDK flush activity against `setTimeout(resolve, timeoutMs)` without validating the supplied duration. With `timeoutMs === Infinity`, Node emits `TimeoutOverflowWarning` and schedules the timeout for one millisecond, so the public method resolves almost immediately even though the mocked `sdk.flush()` promise never settles.

## Expected Behavior

The flush API should reject non-finite timeout values, or give `Infinity` explicitly documented wait-without-timeout semantics. A caller requesting an effectively unbounded flush wait must not receive a successful early return while pending telemetry is still unsent.

## Impact

Integrations that configure an unbounded or computed non-finite shutdown timeout can silently abandon queued telemetry while believing shutdown flushing completed. Pipeline, experiment, superintendent, or spawn traces may be lost at process termination, and the only runtime clue is a timer warning rather than an actionable failure from the telemetry API.
