# Braintrust flush success leaves timeout timer pending

## Summary

`BraintrustClient.flush(timeoutMs)` implements its timeout with `Promise.race([flushAll, setTimeout(...)])`, but never cancels the timer when all flush operations finish successfully first. Every successful shutdown therefore leaves a timer scheduled for the full timeout duration; the integration's default shutdown path uses five seconds.

## Reproduction

From the repository root, run a disposable Vitest probe with fake timers and a Braintrust SDK whose flush resolves immediately:

```sh
cat > /tmp/braintrust-flush-timer-probe.test.ts <<'EOF'
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("braintrust", () => ({
  initLogger: vi.fn(() => ({ id: "logger" })),
  flush: vi.fn(async () => {})
}));
import { createClient } from "./client.js";
describe("flush timer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("leaves timeout scheduled after immediate flush success", async () => {
    const client = createClient({ apiKey: "key", project: "project" });
    await client.getRootLogger();
    await client.flush(5000);
    console.log(`pending_timers=${vi.getTimerCount()}`);
    expect(vi.getTimerCount()).toBe(1);
  });
});
EOF
cp /tmp/braintrust-flush-timer-probe.test.ts packages/braintrust/src/__probe__.test.ts
trap 'rm -f packages/braintrust/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-braintrust-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/braintrust/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-braintrust-probe.config.mjs --reporter verbose
nl -ba packages/braintrust/src/client.ts | sed -n '88,118p'
nl -ba packages/braintrust/src/index.ts | sed -n '55,65p'
```

## Observed Behavior

Even after the mocked logger flush completes immediately, one timeout remains scheduled:

```text
pending_timers=1
✓ packages/braintrust/src/__probe__.test.ts > flush timer > leaves timeout scheduled after immediate flush success
```

`flush()` creates an uncancelled timeout promise inside `Promise.race(...)` in `packages/braintrust/src/client.ts:88` through `packages/braintrust/src/client.ts:118`. The integration's `shutdown()` wrapper always calls `client.flush(5000)` in `packages/braintrust/src/index.ts:55` through `packages/braintrust/src/index.ts:65`.

## Expected Behavior

Once telemetry flush finishes before the deadline, the timeout handle should be cleared so successful shutdown completes without leaving pending event-loop work behind.

## Impact

Short-lived CLI commands and test processes using Braintrust can remain alive for up to five extra seconds after a successful telemetry flush, unnecessarily delaying exit and accumulating pending timers when multiple flushes occur.
