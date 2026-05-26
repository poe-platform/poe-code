# Braintrust pipeline cancellation leaves started step span open

## Summary

The Braintrust pipeline callbacks open a step span as soon as `onTaskStart` fires and close it only from `onTaskComplete`. When an in-flight pipeline agent is aborted, `runPipeline()` returns a cancelled result without invoking `onTaskComplete`, so the already-started Braintrust step span is never logged or ended.

## Reproduction

From the repository root, run a disposable Vitest probe that wires the Braintrust pipeline callbacks into a one-task pipeline whose agent aborts after task start:

```sh
cat > /tmp/braintrust-pipeline-cancel-span-probe.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "@poe-code/pipeline";
import { createPipelineCallbacks } from "./adapters/pipeline.js";

const mockBraintrust = vi.hoisted(() => ({ currentSpan: vi.fn() }));
vi.mock("braintrust", () => ({ currentSpan: mockBraintrust.currentSpan }));

describe("pipeline cancellation span lifecycle", () => {
  it("opens a Braintrust step span without closing it when the agent aborts", async () => {
    const stepSpan = { log: vi.fn(), end: vi.fn() };
    const parent = { startSpan: vi.fn(() => stepSpan) };
    mockBraintrust.currentSpan.mockReturnValue(parent);
    const client: any = { recordError: vi.fn() };
    const callbacks = createPipelineCallbacks(client);
    const fs = createFsFromVolume(Volume.fromJSON({
      "/repo/docs/plans/cancel.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: task-1",
        "    title: Cancelled task",
        "    prompt: Abort me",
        "    status: open",
        "---",
        ""
      ].join("\n")
    }, "/")).promises;
    const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/cancel.md",
      fs: fs as any,
      runAgent: vi.fn(async () => { throw abortError; }),
      ...callbacks,
    });

    await new Promise((resolve) => setImmediate(resolve));
    console.log(JSON.stringify({
      stopReason: result.stopReason,
      startSpanCalls: parent.startSpan.mock.calls.length,
      logCalls: stepSpan.log.mock.calls.length,
      endCalls: stepSpan.end.mock.calls.length,
    }));
    expect(result.stopReason).toBe("cancelled");
    expect(parent.startSpan).toHaveBeenCalledTimes(1);
    expect(stepSpan.log).not.toHaveBeenCalled();
    expect(stepSpan.end).not.toHaveBeenCalled();
  });
});
EOF
cp /tmp/braintrust-pipeline-cancel-span-probe.test.ts packages/braintrust/src/__probe__.test.ts
trap 'rm -f packages/braintrust/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-braintrust-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/braintrust/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-braintrust-probe.config.mjs --reporter verbose
nl -ba packages/pipeline/src/run/pipeline.ts | sed -n '460,532p'
nl -ba packages/braintrust/src/row-builder.ts | sed -n '43,91p'
```

## Observed Behavior

The cancelled pipeline run opens one Braintrust step span, but emits no completion log and never ends the span:

```text
{"stopReason":"cancelled","startSpanCalls":1,"logCalls":0,"endCalls":0}
✓ packages/braintrust/src/__probe__.test.ts > pipeline cancellation span lifecycle > opens a Braintrust step span without closing it when the agent aborts
```

`runPipeline()` calls `onTaskStart` before executing the task in `packages/pipeline/src/run/pipeline.ts:468` through `packages/pipeline/src/run/pipeline.ts:508`, but its abort handler returns `stopReason: "cancelled"` directly in `packages/pipeline/src/run/pipeline.ts:509` through `packages/pipeline/src/run/pipeline.ts:522` without notifying `onTaskComplete`. The Braintrust state creates and stores a span from `start()` in `packages/braintrust/src/row-builder.ts:49` through `packages/braintrust/src/row-builder.ts:63`, while its only log/end path is `complete()` in `packages/braintrust/src/row-builder.ts:66` through `packages/braintrust/src/row-builder.ts:91`.

## Expected Behavior

Cancelling a started pipeline step should close its telemetry span, either through a cancellation completion callback or a Braintrust cancellation/finalization path that ends the outstanding span with cancelled status.

## Impact

Any cancelled pipeline task or step can leave an unfinished Braintrust trace row indefinitely. Users see incomplete pipeline traces with missing cancellation outcomes, and repeated cancellation can accumulate orphan spans in observability data.
