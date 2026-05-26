# Braintrust colon-bearing pipeline identifiers share one span row

## Summary

The Braintrust pipeline integration stores in-flight step spans under a colon-delimited string composed from caller-controlled pipeline identifiers. Two distinct valid step executions whose `taskId` and `stepName` distribute colons differently therefore receive the same state key. Starting the second step overwrites the first step's row; completing the first step logs and closes the second step span while the first span is left open.

## Reproduction

Create a disposable probe at `packages/braintrust/src/__probe__.test.ts`:

```ts
import type { TaskCompletion, TaskProgress } from "@poe-code/pipeline";
import { describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import { makePipelineRowState } from "./row-builder.js";

const mockBraintrust = vi.hoisted(() => ({ currentSpan: vi.fn() }));
vi.mock("braintrust", () => ({ currentSpan: mockBraintrust.currentSpan }));

describe("Braintrust pipeline key separator collision", () => {
  it("closes the second span with the first completion and leaks the first", async () => {
    const firstSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const secondSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const parent = {
      startSpan: vi.fn().mockReturnValueOnce(firstSpan).mockReturnValueOnce(secondSpan),
    };
    mockBraintrust.currentSpan.mockReturnValue(parent);
    const client = {
      getSdk: vi.fn(),
      getRootLogger: vi.fn(),
      getExperiment: vi.fn(),
      flush: vi.fn(),
      recordError: vi.fn(),
      status: vi.fn(() => ({ lastError: null, errorCount: 0, project: "project" })),
    } satisfies BraintrustClient;
    const state = makePipelineRowState(client);
    const first = {
      taskId: "task:a",
      taskTitle: "First",
      stepName: "b",
      taskIndex: 1,
      totalTasks: 2,
      stepIndex: 1,
      totalSteps: 1,
    } satisfies TaskProgress;
    const second = {
      taskId: "task",
      taskTitle: "Second",
      stepName: "a:b",
      taskIndex: 1,
      totalTasks: 2,
      stepIndex: 1,
      totalSteps: 1,
    } satisfies TaskProgress;
    const completedFirst = {
      ...first,
      durationMs: 12,
      success: true,
    } satisfies TaskCompletion;

    state.start(first);
    await new Promise((resolve) => setImmediate(resolve));
    state.start(second);
    await new Promise((resolve) => setImmediate(resolve));
    state.complete(completedFirst);
    await new Promise((resolve) => setImmediate(resolve));

    expect(parent.startSpan).toHaveBeenCalledTimes(2);
    expect(secondSpan.end).toHaveBeenCalledTimes(1);
    expect(firstSpan.end).not.toHaveBeenCalled();
    expect(secondSpan.log).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ step_name: "a:b" }),
    }));
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
✓ packages/braintrust/src/__probe__.test.ts > Braintrust pipeline key separator collision > closes the second span with the first completion and leaks the first

Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

`TaskProgress.taskId` and `TaskProgress.stepName` are arbitrary strings in `packages/pipeline/src/types.ts:132` through `packages/pipeline/src/types.ts:141`, and pipeline plans/documented step definitions expose both user-defined values. `makePipelineRowState()` indexes live rows using `pipelineKey(progress)` in `packages/braintrust/src/row-builder.ts:43` through `packages/braintrust/src/row-builder.ts:97`. That helper joins unescaped values with `":"` in `packages/braintrust/src/row-builder.ts:398` through `packages/braintrust/src/row-builder.ts:405`, so the distinct identities `{ taskId: "task:a", stepName: "b" }` and `{ taskId: "task", stepName: "a:b" }` both produce the same map key. In the reproduction, completing the first task consumes the overwritten second row: the second span logs and ends, and the first span remains unended.

## Expected Behavior

Each distinct pipeline task/step identity should track an independent live telemetry span regardless of characters present in valid identifiers. If an identifier encoding cannot represent all accepted strings unambiguously, the integration should use structured keys or reject unsupported identifiers before opening spans.

## Impact

Plans that use colons in task IDs or named steps can corrupt Braintrust telemetry whenever another live execution maps to the same delimited key. Logs become attributed to the wrong step, valid spans leak indefinitely, and dashboards may display an apparent successful completion for work that has not completed while omitting the event that actually did.
