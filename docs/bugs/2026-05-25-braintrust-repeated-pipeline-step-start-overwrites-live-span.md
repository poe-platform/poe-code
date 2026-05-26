# Braintrust repeated pipeline step start overwrites live span

## Summary

`makePipelineRowState()` permits the same pipeline step to be started more than once before it completes. Each repeated `start()` opens a new Braintrust step span and replaces the existing row stored for that derived key. Completing the step only logs and ends the most recently stored span, leaving the prior live span orphaned.

## Reproduction

From the repository root, run a disposable Vitest probe that starts one identical pipeline step twice after each asynchronous span creation resolves, then completes it once:

```sh
cat > packages/braintrust/src/__probe__.test.ts <<'EOF'
import type { TaskCompletion, TaskProgress } from "@poe-code/pipeline";
import { describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import { makePipelineRowState } from "./row-builder.js";

const mockBraintrust = vi.hoisted(() => ({ currentSpan: vi.fn() }));
vi.mock("braintrust", () => ({ currentSpan: mockBraintrust.currentSpan }));

describe("pipeline repeated start lifecycle repro", () => {
  it("leaves a span open when the same step starts again", async () => {
    const firstSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const secondSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const parent = {
      startSpan: vi.fn()
        .mockReturnValueOnce(firstSpan)
        .mockReturnValueOnce(secondSpan),
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
    state.start(started);
    await vi.waitFor(() => expect(parent.startSpan).toHaveBeenCalledTimes(2));
    state.complete(completed);
    await vi.waitFor(() => expect(secondSpan.end).toHaveBeenCalledTimes(1));

    console.log(JSON.stringify({
      started: parent.startSpan.mock.calls.length,
      firstLog: firstSpan.log.mock.calls.length,
      firstEnd: firstSpan.end.mock.calls.length,
      secondLog: secondSpan.log.mock.calls.length,
      secondEnd: secondSpan.end.mock.calls.length,
    }));

    expect(firstSpan.log).not.toHaveBeenCalled();
    expect(firstSpan.end).not.toHaveBeenCalled();
    expect(secondSpan.log).toHaveBeenCalledTimes(1);
    expect(secondSpan.end).toHaveBeenCalledTimes(1);
  });
});
EOF
npm exec -- vitest run packages/braintrust/src/__probe__.test.ts --reporter verbose
rm -f packages/braintrust/src/__probe__.test.ts
nl -ba packages/braintrust/src/row-builder.ts | sed -n '43,91p;398,409p'
```

## Observed Behavior

The repeated pipeline start opens two spans for the same step key, but the single completion only finalizes the replacement span:

```text
{"started":2,"firstLog":0,"firstEnd":0,"secondLog":1,"secondEnd":1}
✓ packages/braintrust/src/__probe__.test.ts > pipeline repeated start lifecycle repro > leaves a span open when the same step starts again
```

`start()` derives a key using `pipelineKey()` and then unconditionally replaces the map row at that key while opening a fresh span in `packages/braintrust/src/row-builder.ts:49` through `packages/braintrust/src/row-builder.ts:63` and `packages/braintrust/src/row-builder.ts:398` through `packages/braintrust/src/row-builder.ts:407`. `complete()` retrieves and deletes only the last stored row and therefore logs and ends only its span in `packages/braintrust/src/row-builder.ts:66` through `packages/braintrust/src/row-builder.ts:91`.

## Expected Behavior

Repeated starts for an already-running pipeline step should not discard its active telemetry span. The state should preserve one tracked lifecycle, explicitly supersede and close an old span, or reject duplicate starts without opening a second untracked span.

## Impact

Any duplicated or retried pipeline step-start notification can leak an unfinished Braintrust span even though the step eventually completes successfully. Pipeline telemetry can contain misleading incomplete sibling spans and accumulate open trace records independently of the existing cancellation leak path.
