# Braintrust repeated experiment start overwrites live span

## Summary

`makeExperimentIterationState()` permits `start()` to be called more than once for the same experiment iteration index. Each call opens a Braintrust span, but the second `rows.set(index, ...)` replaces the first stored row without ending it. Completing that iteration only logs and closes the replacement span, permanently abandoning the originally opened span.

## Reproduction

From the repository root, run a disposable Vitest probe that starts experiment iteration `3` twice before completing it:

```sh
cat > packages/braintrust/src/__probe__.test.ts <<'EOF'
import type { JournalEntry } from "@poe-code/experiment-loop";
import { describe, expect, it, vi } from "vitest";

import type { BraintrustClient } from "./client.js";
import { makeExperimentIterationState } from "./row-builder.js";

describe("experiment repeated start lifecycle repro", () => {
  it("leaves the first span open when the same iteration starts again", async () => {
    const firstSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const secondSpan = { startSpan: vi.fn(), log: vi.fn(), end: vi.fn() };
    const experiment = {
      startSpan: vi.fn()
        .mockReturnValueOnce(firstSpan)
        .mockReturnValueOnce(secondSpan),
    };
    const client = {
      getSdk: vi.fn(),
      getRootLogger: vi.fn(),
      getExperiment: vi.fn(async () => experiment),
      flush: vi.fn(),
      recordError: vi.fn(),
      status: vi.fn(() => ({ lastError: null, errorCount: 0, project: "project" })),
    } satisfies BraintrustClient;
    const state = makeExperimentIterationState(client, "benchmarks");
    const entry = {
      commit: "keep-123",
      status: "keep",
      scores: { tests: 15 },
      output: "tests: score=15, passed=true",
      agentOutput: "Done",
      durationMs: 3210,
      timestamp: "2026-05-25T12:00:00.000Z",
      brief: "Improve parser",
    } satisfies JournalEntry & Record<string, unknown>;

    await state.start(3, "codex-first");
    await state.start(3, "codex-second");
    await state.complete(3, entry);

    console.log(JSON.stringify({
      started: experiment.startSpan.mock.calls.length,
      firstLog: firstSpan.log.mock.calls.length,
      firstEnd: firstSpan.end.mock.calls.length,
      secondLog: secondSpan.log.mock.calls.length,
      secondEnd: secondSpan.end.mock.calls.length,
    }));

    expect(experiment.startSpan).toHaveBeenCalledTimes(2);
    expect(firstSpan.log).not.toHaveBeenCalled();
    expect(firstSpan.end).not.toHaveBeenCalled();
    expect(secondSpan.log).toHaveBeenCalledTimes(1);
    expect(secondSpan.end).toHaveBeenCalledTimes(1);
  });
});
EOF
npm exec -- vitest run packages/braintrust/src/__probe__.test.ts --reporter verbose
rm -f packages/braintrust/src/__probe__.test.ts
nl -ba packages/braintrust/src/row-builder.ts | sed -n '126,220p'
```

## Observed Behavior

The repeated start opens two spans for the same iteration, but only the second span receives the completion event and is closed:

```text
{"started":2,"firstLog":0,"firstEnd":0,"secondLog":1,"secondEnd":1}
✓ packages/braintrust/src/__probe__.test.ts > experiment repeated start lifecycle repro > leaves the first span open when the same iteration starts again
```

`start()` always opens a new span and unconditionally assigns it into the row map with `rows.set(index, ...)` in `packages/braintrust/src/row-builder.ts:141` through `packages/braintrust/src/row-builder.ts:157`. If a row already exists for that index, its span is replaced without being logged or ended. Later, `complete()` reads only the remaining row and logs/ends that single span in `packages/braintrust/src/row-builder.ts:203` through `packages/braintrust/src/row-builder.ts:220`.

## Expected Behavior

Repeated start notifications for an already-live experiment iteration should not orphan its existing span. The state should either reuse the active row, explicitly close/supersede the previous span, or reject the duplicate lifecycle transition without opening another untracked span.

## Impact

Duplicate or retried experiment-start events produce incomplete Braintrust trace data and leak open spans. A completed iteration can appear alongside an abandoned sibling span with no outcome, reducing telemetry reliability and potentially accumulating unfinished trace records over repeated runs.
