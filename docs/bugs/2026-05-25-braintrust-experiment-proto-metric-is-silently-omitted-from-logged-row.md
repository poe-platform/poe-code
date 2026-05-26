# Braintrust experiment proto metric is silently omitted from logged row

## Summary

The Braintrust experiment integration accepts arbitrary metric names from experiment callbacks, but silently drops a metric named `__proto__` before logging the iteration row. An experiment can report a finite score under that name and complete normally while the emitted telemetry contains no such recorded metric.

## Reproduction

From the repository root, add a disposable probe at `packages/braintrust/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeExperimentIterationState } from "./row-builder.js";

describe("Braintrust special experiment metric names", () => {
  it("drops an explicitly recorded __proto__ metric from the logged iteration", async () => {
    const log = vi.fn();
    const state = makeExperimentIterationState({
      getExperiment: vi.fn(async () => ({
        startSpan: vi.fn(() => ({ log, end: vi.fn() }))
      })),
      recordError: vi.fn()
    } as never, "benchmarks");

    await state.start(1, "codex");
    state.metric("__proto__", 42);
    await state.complete(1, { status: "keep", agentOutput: "done", durationMs: 1 } as never);

    expect(log).toHaveBeenCalledWith(expect.not.objectContaining({ metrics: { "__proto__": 42 } }));
    expect(log.mock.calls[0]?.[0].metrics).toEqual({ durationMs: 1 });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/braintrust/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/braintrust/src/__probe__.test.ts > Braintrust special experiment metric names > drops an explicitly recorded __proto__ metric from the logged iteration
```

Remove the disposable probe after running it.

## Observed Behavior

After `state.metric("__proto__", 42)`, completing the iteration logs only `{ durationMs: 1 }` in the `metrics` object; the explicitly recorded metric is missing. `makeExperimentIterationState()` in `packages/braintrust/src/row-builder.ts` initializes each row's metric record as `{}` and stores dynamic metric names with `row.metrics[name] = value`. For `__proto__`, the write changes the metric record prototype instead of creating an own enumerable metric, and the later spread into the logged metric payload omits it.

## Expected Behavior

Every accepted experiment metric name should be logged as an own metric field with its recorded numeric value, including data keys such as `__proto__`, or rejected explicitly before reporting success. Telemetry accumulation must not silently discard valid callback results because of object prototype behavior.

## Impact

Experiment telemetry can lose recorded measurements, making Braintrust dashboards and analyses incomplete or misleading. This undermines metric-based evaluation and debugging because experiments appear to complete while specific valid metric results disappear from observability output.
