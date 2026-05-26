# Braintrust delta experiment score is overwritten by synthetic aggregate

## Summary

The Braintrust experiment integration forwards arbitrary scored metric names from journal entries, including `delta`, but uses that same `scores.delta` key for its own computed sum of score changes. When an experiment defines a real metric named `delta` alongside another measured metric, the emitted Braintrust row silently replaces the configured `delta` score with the integration's aggregate value.

## Reproduction

Create a disposable probe at `packages/braintrust/src/__probe__.test.ts`:

```ts
import type { JournalEntry } from "@poe-code/experiment-loop";
import { describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import { makeExperimentIterationState } from "./row-builder.js";

describe("Braintrust experiment delta score collision", () => {
  it("replaces a configured delta score with its synthetic aggregate", async () => {
    const iterationSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const client = {
      getSdk: vi.fn(),
      getRootLogger: vi.fn(),
      getExperiment: vi.fn(async () => ({ startSpan: vi.fn(() => iterationSpan) })),
      flush: vi.fn(),
      recordError: vi.fn(),
      status: vi.fn(() => ({ lastError: null, errorCount: 0, project: "project" })),
    } satisfies BraintrustClient;
    const state = makeExperimentIterationState(client, "benchmarks");
    const entry = {
      commit: "keep-123",
      status: "keep",
      scores: { tests: 15, delta: 42 },
      output: "scores recorded",
      agentOutput: "Improved measurements",
      durationMs: 200,
      timestamp: "2026-05-26T12:00:00.000Z",
    } satisfies JournalEntry;

    state.baseline({ tests: 10, delta: 40 });
    await state.start(1, "codex");
    await state.complete(1, entry);

    const logged = iterationSpan.log.mock.calls[0]?.[0] as {
      scores: Record<string, number>;
    };
    expect(logged.scores).toEqual({ tests: 15, delta: 7 });
    expect(logged.scores.delta).not.toBe(42);
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
✓ packages/braintrust/src/__probe__.test.ts > Braintrust experiment delta score collision > replaces a configured delta score with its synthetic aggregate

Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

Experiment journal entries expose scores as an unconstrained `Record<string, number>` and `buildExperimentScores()` initially preserves those entries using `{ ...(scores ?? {}) }` in `packages/braintrust/src/row-builder.ts:335` through `packages/braintrust/src/row-builder.ts:347`. It then calculates `sumDelta()` over the baseline and current scores and unconditionally assigns the result to `result.delta`. In the reproduction, the plan's actual `delta` score is `42`, but the integration calculates `(15 - 10) + (42 - 40) = 7` and emits `{ tests: 15, delta: 7 }`, destroying the configured score value before it reaches Braintrust.

## Expected Behavior

User-configured experiment score names should remain intact in emitted telemetry. If aggregate score change is provided as additional Braintrust metadata, it should use a non-conflicting key or the integration should clearly reserve and reject `delta` as a configured metric name.

## Impact

Experiment authors can legitimately use a metric called `delta` to measure a domain-specific objective. For those runs, Braintrust dashboards, filters, and comparisons report an unrelated synthetic aggregate under that metric name, silently corrupting experiment results and potentially reversing optimization decisions based on the observed score.
