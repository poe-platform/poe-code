# Braintrust duplicate pipeline completion logs second success span

## Summary

`makePipelineRowState()` treats a pipeline completion received after the tracked step row has already been completed as a new standalone telemetry event. A duplicate `complete()` call for one successful step opens another Braintrust span, logs another success result, and ends it. One logical pipeline step is therefore recorded as two independently successful trace spans.

## Reproduction

From the repository root, run a disposable Vitest probe that starts one pipeline step once and reports the identical completion twice:

```sh
cat > packages/braintrust/src/__probe__.test.ts <<'EOF'
import type { TaskCompletion, TaskProgress } from "@poe-code/pipeline";
import { describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import { makePipelineRowState } from "./row-builder.js";

const mockBraintrust = vi.hoisted(() => ({ currentSpan: vi.fn() }));
vi.mock("braintrust", () => ({ currentSpan: mockBraintrust.currentSpan }));

describe("pipeline duplicate completion repro", () => {
  it("logs two successful spans when one step completes twice", async () => {
    const startedSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const duplicateSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const parent = {
      startSpan: vi.fn()
        .mockReturnValueOnce(startedSpan)
        .mockReturnValueOnce(duplicateSpan),
    };
    mockBraintrust.currentSpan.mockReturnValue(parent);
    const client = { recordError: vi.fn() } as unknown as BraintrustClient;
    const state = makePipelineRowState(client);
    const started = {
      taskId: "task-1", taskTitle: "Implement", stepName: "builder", taskIndex: 1,
      totalTasks: 1, stepIndex: 1, totalSteps: 1,
    } satisfies TaskProgress;
    const completed = { ...started, success: true, durationMs: 10 } satisfies TaskCompletion;

    state.start(started);
    await vi.waitFor(() => expect(parent.startSpan).toHaveBeenCalledTimes(1));
    state.complete(completed);
    await vi.waitFor(() => expect(startedSpan.end).toHaveBeenCalledTimes(1));
    state.complete(completed);
    await vi.waitFor(() => expect(duplicateSpan.end).toHaveBeenCalledTimes(1));

    console.log(JSON.stringify({
      started: parent.startSpan.mock.calls.length,
      originalLogs: startedSpan.log.mock.calls.length,
      originalEnds: startedSpan.end.mock.calls.length,
      duplicateLogs: duplicateSpan.log.mock.calls.length,
      duplicateEnds: duplicateSpan.end.mock.calls.length,
    }));

    expect(parent.startSpan).toHaveBeenCalledTimes(2);
    expect(startedSpan.log).toHaveBeenCalledTimes(1);
    expect(startedSpan.end).toHaveBeenCalledTimes(1);
    expect(duplicateSpan.log).toHaveBeenCalledTimes(1);
    expect(duplicateSpan.end).toHaveBeenCalledTimes(1);
  });
});
EOF
npm exec -- vitest run packages/braintrust/src/__probe__.test.ts --reporter verbose
rm -f packages/braintrust/src/__probe__.test.ts
nl -ba packages/braintrust/src/row-builder.ts | sed -n '43,91p'
```

## Observed Behavior

The single started step is represented by two completed success spans after its completion callback is repeated:

```text
{"started":2,"originalLogs":1,"originalEnds":1,"duplicateLogs":1,"duplicateEnds":1}
✓ packages/braintrust/src/__probe__.test.ts > pipeline duplicate completion repro > logs two successful spans when one step completes twice
```

`complete()` deletes the stored row immediately in `packages/braintrust/src/row-builder.ts:66` through `packages/braintrust/src/row-builder.ts:70`. On a later completion for the same key, the missing row deliberately selects the `openCurrentChildSpan(...)` fallback in `packages/braintrust/src/row-builder.ts:72` through `packages/braintrust/src/row-builder.ts:79`, and then logs and ends that newly created span in `packages/braintrust/src/row-builder.ts:81` through `packages/braintrust/src/row-builder.ts:89`. The state does not remember that the key was already finalized.

## Expected Behavior

Once a pipeline step has been completed and its tracked span finalized, a repeated completion notification for the same step should be ignored, deduplicated, or reported as an invalid lifecycle transition rather than emitted as another successful step span.

## Impact

Retries or duplicated completion delivery inflate successful pipeline-step telemetry and can make a single execution appear to have performed work twice. Braintrust-derived dashboards, counts, durations, or success metrics become inaccurate even though the underlying pipeline executed only one step.
