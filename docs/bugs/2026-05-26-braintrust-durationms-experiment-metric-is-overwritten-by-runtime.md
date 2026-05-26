# Braintrust durationMs experiment metric is overwritten by runtime

## Summary

The Braintrust experiment integration accepts arbitrary metric names from an experiment plan, including `durationMs`, but reserves that same key internally for iteration runtime. When an experiment reports a legitimate configured metric named `durationMs`, the row builder records the score in `scores` and then silently overwrites its corresponding telemetry metric value with the journal entry's elapsed runtime before logging the row.

## Reproduction

Create a disposable probe at `packages/braintrust/src/__probe__.test.ts`:

```ts
import type { JournalEntry } from "@poe-code/experiment-loop";
import { describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import { makeExperimentIterationState } from "./row-builder.js";

describe("Braintrust experiment metric name collision", () => {
  it("replaces a configured durationMs metric with journal runtime", async () => {
    const iterationSpan = {
      startSpan: vi.fn(),
      log: vi.fn(),
      end: vi.fn(),
    };
    const client = {
      getSdk: vi.fn(),
      getRootLogger: vi.fn(),
      getExperiment: vi.fn(async () => ({
        startSpan: vi.fn(() => iterationSpan),
      })),
      flush: vi.fn(),
      recordError: vi.fn(),
      status: vi.fn(() => ({ lastError: null, errorCount: 0, project: "project" })),
    } satisfies BraintrustClient;
    const state = makeExperimentIterationState(client, "benchmarks");
    const entry = {
      commit: "keep-123",
      status: "keep",
      scores: { durationMs: 77 },
      output: "durationMs: score=77, passed=true",
      agentOutput: "Reduced benchmark duration",
      durationMs: 4321,
      timestamp: "2026-05-26T12:00:00.000Z",
    } satisfies JournalEntry;

    await state.start(1, "codex");
    state.metric("durationMs", 77);
    await state.complete(1, entry);

    const logged = iterationSpan.log.mock.calls[0]?.[0] as {
      metrics: Record<string, number>;
    };
    expect(logged.metrics.durationMs).toBe(4321);
    expect(logged.metrics.durationMs).not.toBe(77);
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/braintrust/src/__probe__.test.ts --reporter verbose
rm packages/braintrust/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/braintrust/src/__probe__.test.ts > Braintrust experiment metric name collision > replaces a configured durationMs metric with journal runtime

Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

`createExperimentCallbacks()` forwards every non-null experiment metric using its configured name in `packages/braintrust/src/adapters/experiment.ts:31` through `packages/braintrust/src/adapters/experiment.ts:35`. `makeExperimentIterationState().metric()` stores that value under the same key in `packages/braintrust/src/row-builder.ts:170` through `packages/braintrust/src/row-builder.ts:179`. During completion, however, `buildExperimentLog()` first copies all accumulated metric values and then assigns the built-in elapsed runtime to `metrics.durationMs` in `packages/braintrust/src/row-builder.ts:287` through `packages/braintrust/src/row-builder.ts:317`. In the reproduction, the configured `durationMs` metric value `77` is therefore absent from emitted `metrics`; only elapsed runtime `4321` remains under that key.

## Expected Behavior

Configured experiment metrics and built-in runtime telemetry should remain separately observable. Reporting a valid experiment metric named `durationMs` should not silently discard its value when the integration also records iteration elapsed duration.

## Impact

Experiment plans may use `durationMs` as a meaningful objective name, especially when minimizing benchmark latency. Braintrust rows for those runs present the elapsed orchestration runtime as though it were the configured evaluated metric, corrupting dashboards and metric comparisons while hiding the actual optimization score.
