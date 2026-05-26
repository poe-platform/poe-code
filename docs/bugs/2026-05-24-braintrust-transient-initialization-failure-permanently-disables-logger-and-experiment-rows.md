# Braintrust transient initialization failure permanently disables logger and experiment rows

## Summary

`BraintrustClient` caches the resolved result of its first `initLogger()` call and each first `initExperiment(name)` call even when initialization throws and is converted to `undefined`. After one transient SDK or network initialization failure, later pipeline/spawn traces never retry the root logger and later iterations for the same experiment never retry experiment initialization, so observability remains disabled for the rest of that integration instance after the underlying condition has recovered.

## Reproduction

From the repository root, run a disposable Vitest probe whose Braintrust initialization fails once and would succeed on the next attempt:

```sh
cat > packages/braintrust/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";
import { makeExperimentIterationState } from "./row-builder.js";
import { makeTraceRun } from "./trace-run.js";
const mockBraintrust = vi.hoisted(() => ({
  initLogger: vi.fn(),
  initExperiment: vi.fn(),
  traced: vi.fn(),
}));
vi.mock("braintrust", () => ({
  initLogger: mockBraintrust.initLogger,
  initExperiment: mockBraintrust.initExperiment,
  traced: mockBraintrust.traced,
}));
describe("Braintrust transient initialization failure caching", () => {
  it("never retries a logger or experiment after one transient init error", async () => {
    const logger = { id: "logger" };
    const iterationSpan = { log: vi.fn(), end: vi.fn() };
    const experiment = { startSpan: vi.fn(() => iterationSpan) };
    mockBraintrust.initLogger
      .mockImplementationOnce(() => { throw new Error("network hiccup"); })
      .mockReturnValueOnce(logger);
    mockBraintrust.initExperiment
      .mockImplementationOnce(() => { throw new Error("network hiccup"); })
      .mockReturnValueOnce(experiment);
    mockBraintrust.traced.mockImplementation(async (fn: () => Promise<unknown>) => fn());
    const client = createClient({ apiKey: "key", project: "project" });
    const traceRun = makeTraceRun(client);
    const iterations = makeExperimentIterationState(client, "benchmark");
    await expect(traceRun("pipeline", "first", async () => "first")).resolves.toBe("first");
    await expect(traceRun("pipeline", "second", async () => "second")).resolves.toBe("second");
    await iterations.start(1, "codex");
    await iterations.start(2, "codex");
    console.log(JSON.stringify({
      initLoggerCalls: mockBraintrust.initLogger.mock.calls.length,
      tracedCalls: mockBraintrust.traced.mock.calls.length,
      initExperimentCalls: mockBraintrust.initExperiment.mock.calls.length,
      iterationSpansOpened: experiment.startSpan.mock.calls.length,
      status: client.status(),
    }));
    expect(mockBraintrust.initLogger).toHaveBeenCalledTimes(1);
    expect(mockBraintrust.traced).not.toHaveBeenCalled();
    expect(mockBraintrust.initExperiment).toHaveBeenCalledTimes(1);
    expect(experiment.startSpan).not.toHaveBeenCalled();
  });
});
EOF
cat > /tmp/vitest-braintrust-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/braintrust/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
trap 'rm -f packages/braintrust/src/__probe__.test.ts /tmp/vitest-braintrust-probe.config.mjs' EXIT
./node_modules/.bin/vitest run --config /tmp/vitest-braintrust-probe.config.mjs --reporter verbose
nl -ba packages/braintrust/src/client.ts | sed -n '20,85p'
nl -ba packages/braintrust/src/trace-run.ts | sed -n '27,68p'
nl -ba packages/braintrust/src/row-builder.ts | sed -n '141,157p'
```

## Observed Behavior

The second root trace and the second iteration occur after the mock is ready to initialize successfully, but neither initializer is called again and no telemetry span is opened:

```text
{"initLoggerCalls":1,"tracedCalls":0,"initExperimentCalls":1,"iterationSpansOpened":0,"status":{"lastError":"experiment benchmark iteration start: Braintrust span parent unavailable","errorCount":6,"project":"project"}}
✓ packages/braintrust/src/__probe__.test.ts > Braintrust transient initialization failure caching > never retries a logger or experiment after one transient init error
```

`getRootLogger()` assigns its initialization promise once and retains the `undefined` failure result in `packages/braintrust/src/client.ts:55` through `packages/braintrust/src/client.ts:67`; `makeTraceRun()` therefore falls back without attempting to trace every later root run in `packages/braintrust/src/trace-run.ts:27` through `packages/braintrust/src/trace-run.ts:68`. Likewise, `getExperiment(name)` stores the first failed initialization promise in its map in `packages/braintrust/src/client.ts:69` through `packages/braintrust/src/client.ts:84`, and iteration start can never open a row for that experiment name in `packages/braintrust/src/row-builder.ts:141` through `packages/braintrust/src/row-builder.ts:157`.

## Expected Behavior

Initialization failures that are swallowed to keep orchestration running should not permanently cache an unavailable logger or experiment. A later root run or experiment iteration should retry initialization, allowing telemetry collection to recover once the transient SDK or network failure clears.

## Impact

A brief Braintrust outage or intermittent initialization failure at startup can silently disable all pipeline/spawn trace roots and all rows for an affected experiment name until the process recreates the integration. Long-running agents continue working without observability even after Braintrust is healthy, losing run history, iteration metrics, scores, and diagnostic data.
