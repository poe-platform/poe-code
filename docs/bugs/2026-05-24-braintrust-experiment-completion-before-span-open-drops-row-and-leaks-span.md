# Braintrust experiment completion before span open drops row and leaks span

## Summary

Braintrust experiment callbacks start each iteration asynchronously using `void state.start(...)`. If an iteration completes before `client.getExperiment(...)` resolves, `complete()` finds no stored row and returns without logging. When the delayed start eventually resolves, it creates and stores a span for an already-completed iteration; that span is never logged or ended.

## Reproduction

From the repository root, run a disposable Vitest probe whose Braintrust experiment object resolves only after start, metric, and completion callbacks have already fired:

```sh
cat > /tmp/braintrust-experiment-start-complete-race-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { createExperimentCallbacks } from "./adapters/experiment.js";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
describe("experiment callback start race", () => {
  it("drops completion and opens an orphan span when start setup resolves late", async () => {
    const pendingExperiment = deferred<any>();
    const span = { log: vi.fn(), end: vi.fn() };
    const experiment = { startSpan: vi.fn(() => span) };
    const client: any = {
      getExperiment: vi.fn(() => pendingExperiment.promise),
      recordError: vi.fn()
    };
    const callbacks = createExperimentCallbacks(client, "exp");
    callbacks.onExperimentStart!(1, "codex");
    callbacks.onMetricResult!({ name: "score" } as any, { score: 0.9 } as any);
    callbacks.onExperimentComplete!(1, {
      status: "keep",
      scores: { score: 0.9 },
      durationMs: 12,
      agentOutput: "done"
    } as any);
    pendingExperiment.resolve(experiment);
    await new Promise((resolve) => setImmediate(resolve));
    console.log(JSON.stringify({
      startSpanCalls: experiment.startSpan.mock.calls.length,
      logCalls: span.log.mock.calls.length,
      endCalls: span.end.mock.calls.length
    }));
    expect(experiment.startSpan).toHaveBeenCalledTimes(1);
    expect(span.log).not.toHaveBeenCalled();
    expect(span.end).not.toHaveBeenCalled();
  });
});
EOF
cp /tmp/braintrust-experiment-start-complete-race-probe.test.ts packages/braintrust/src/__probe__.test.ts
trap 'rm -f packages/braintrust/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-braintrust-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/braintrust/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-braintrust-probe.config.mjs --reporter verbose
nl -ba packages/braintrust/src/adapters/experiment.ts | sed -n '16,49p'
nl -ba packages/braintrust/src/row-builder.ts | sed -n '126,221p'
```

## Observed Behavior

The delayed start creates one Braintrust span after completion has already been discarded, and that span receives no log event and no end call:

```text
{"startSpanCalls":1,"logCalls":0,"endCalls":0}
✓ packages/braintrust/src/__probe__.test.ts > experiment callback start race > drops completion and opens an orphan span when start setup resolves late
```

The callback adapter discards the asynchronous start promise with `void state.start(index, agent)` and similarly does not await completion in `packages/braintrust/src/adapters/experiment.ts:16` through `packages/braintrust/src/adapters/experiment.ts:49`. The row state stores an iteration only after awaiting experiment initialization and opening a span in `packages/braintrust/src/row-builder.ts:141` through `packages/braintrust/src/row-builder.ts:157`, while `complete()` immediately reads/deletes the row and returns if no span exists in `packages/braintrust/src/row-builder.ts:203` through `packages/braintrust/src/row-builder.ts:220`.

## Expected Behavior

Iteration state should be reserved synchronously when start is reported, or completion should await in-flight span setup, so every completed experiment iteration either logs and closes its span or avoids creating a span after completion.

## Impact

Fast iterations or slow Braintrust initialization can silently lose experiment results, metrics, commit/reset metadata, and scores while leaving orphaned remote spans open. Telemetry no longer reliably represents completed experiment iterations and may accumulate incomplete traces.
