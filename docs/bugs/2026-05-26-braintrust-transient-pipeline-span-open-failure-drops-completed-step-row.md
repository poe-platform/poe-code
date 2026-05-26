# Braintrust transient pipeline span-open failure drops completed step row

## Summary

The Braintrust pipeline state stores the promise returned while opening a child span as soon as a step starts. If that initial span-open attempt encounters a transient Braintrust context failure, the helper resolves the stored promise to `undefined`. Even when tracing becomes available again before the same pipeline step completes, completion consumes the stored failed promise rather than retrying span creation, so the completed step is never logged.

## Reproduction

Create a disposable probe at `packages/braintrust/src/__probe__.test.ts`:

```ts
import type { TaskCompletion, TaskProgress } from "@poe-code/pipeline";
import { describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import { makePipelineRowState } from "./row-builder.js";

const mockBraintrust = vi.hoisted(() => ({ currentSpan: vi.fn() }));
vi.mock("braintrust", () => ({ currentSpan: mockBraintrust.currentSpan }));

describe("Braintrust pipeline transient span-open failure", () => {
  it("does not retry at completion after starting the same step fails once", async () => {
    const stepSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const parent = { startSpan: vi.fn(() => stepSpan) };
    mockBraintrust.currentSpan
      .mockImplementationOnce(() => {
        throw new Error("temporary trace context outage");
      })
      .mockReturnValue(parent);
    const client = {
      getSdk: vi.fn(),
      getRootLogger: vi.fn(),
      getExperiment: vi.fn(),
      flush: vi.fn(),
      recordError: vi.fn(),
      status: vi.fn(() => ({ lastError: null, errorCount: 0, project: "project" })),
    } satisfies BraintrustClient;
    const state = makePipelineRowState(client);
    const started = {
      taskId: "task-1",
      taskTitle: "Task",
      stepName: "build",
      taskIndex: 1,
      totalTasks: 1,
      stepIndex: 1,
      totalSteps: 1,
    } satisfies TaskProgress;
    const completed = { ...started, durationMs: 12, success: true } satisfies TaskCompletion;

    state.start(started);
    await new Promise((resolve) => setImmediate(resolve));
    state.complete(completed);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockBraintrust.currentSpan).toHaveBeenCalledTimes(1);
    expect(parent.startSpan).not.toHaveBeenCalled();
    expect(stepSpan.log).not.toHaveBeenCalled();
    expect(stepSpan.end).not.toHaveBeenCalled();
    expect(client.recordError).toHaveBeenCalledWith(expect.any(Error), "pipeline step start");
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
✓ packages/braintrust/src/__probe__.test.ts > Braintrust pipeline transient span-open failure > does not retry at completion after starting the same step fails once

Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

On start, `makePipelineRowState()` stores `openCurrentChildSpan(...)` in the row immediately at `packages/braintrust/src/row-builder.ts:49` through `packages/braintrust/src/row-builder.ts:63`. `openCurrentChildSpan()` catches a failed `currentSpan()` or `startSpan()` call, records the error, and resolves to `undefined` at `packages/braintrust/src/row-builder.ts:224` through `packages/braintrust/src/row-builder.ts:236`. On completion, the code retries span creation only if no stored promise exists; when the stored promise instead resolves to `undefined`, it returns without logging at `packages/braintrust/src/row-builder.ts:66` through `packages/braintrust/src/row-builder.ts:97`. In the reproduction, the second configured `currentSpan()` result is never consulted even though it would create a valid span for the completed step.

## Expected Behavior

Transient Braintrust span-open failures should not permanently suppress telemetry for a step that later completes while tracing is available. Completion should be able to retry opening a row when the stored start attempt yielded no span, or otherwise record the final step through a recovery path.

## Impact

A brief asynchronous-context or Braintrust SDK failure at pipeline step start can silently drop the entire terminal telemetry event for successfully completed work, including status, duration, output summary, and token usage. Long-running pipelines can therefore lose isolated completed-step rows even though the telemetry backend has recovered before completion.
