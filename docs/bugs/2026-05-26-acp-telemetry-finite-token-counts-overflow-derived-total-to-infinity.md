# ACP telemetry finite token counts overflow derived total to Infinity

## Summary

`@poe-code/acp-telemetry` validates individual usage values as finite numbers, but derives the aggregate `tokens` metric by adding `prompt_tokens` and `completion_tokens` without validating the sum. Two valid finite token counts can therefore produce `Infinity`, which is retained in the generated trace and forwarded to the Braintrust telemetry sink as a non-finite metric.

## Reproduction

Create the disposable probe `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emitToBraintrust, type BraintrustSpanLike } from "./emit-braintrust.js";
import { acpToTrace } from "./trace.js";

describe("telemetry token total overflow", () => {
  it("forwards an infinite aggregate derived from finite usage inputs", () => {
    const logged: Array<Record<string, unknown>> = [];
    const sink: BraintrustSpanLike = {
      startSpan: () => sink,
      log: (event) => logged.push(event as Record<string, unknown>),
      end: () => undefined
    };
    const trace = acpToTrace({
      agent: "codex",
      prompt: "run",
      mode: "one-shot",
      cwd: "/tmp",
      sessionId: "session",
      threadId: "thread",
      usage: {
        prompt_tokens: Number.MAX_VALUE,
        completion_tokens: Number.MAX_VALUE
      },
      events: []
    } as never);

    emitToBraintrust(trace, sink);
    const metrics = logged[0]?.metrics as Record<string, number>;
    console.log({
      prompt: metrics.prompt_tokens,
      completion: metrics.completion_tokens,
      total: String(metrics.tokens)
    });

    expect(Number.isFinite(metrics.prompt_tokens)).toBe(true);
    expect(Number.isFinite(metrics.completion_tokens)).toBe(true);
    expect(metrics.tokens).toBe(Infinity);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
```

Result:

```text
{
  prompt: 1.7976931348623157e+308,
  completion: 1.7976931348623157e+308,
  total: 'Infinity'
}
✓ packages/acp-telemetry/src/__probe__.test.ts > telemetry token total overflow > forwards an infinite aggregate derived from finite usage inputs
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`buildMetrics()` in `packages/acp-telemetry/src/trace.ts:160` reads each supplied usage number through `readNumber()`, which accepts finite values only. When no explicit `usage.tokens` is provided, it calls `sumIfPresent(promptTokens, completionTokens)` at `packages/acp-telemetry/src/trace.ts:170`, and `sumIfPresent()` at `packages/acp-telemetry/src/trace.ts:243` returns the arithmetic sum without a second finite-number check. For two finite `Number.MAX_VALUE` inputs, the generated trace contains `metrics.tokens === Infinity`. `emitToBraintrust()` in `packages/acp-telemetry/src/emit-braintrust.ts:30` forwards the trace metrics object directly to `span.log()`, so the non-finite derived metric reaches the telemetry sink unchanged.

## Expected Behavior

Derived metrics should satisfy the same finite-number invariant as directly supplied usage metrics. If individual values overflow when aggregated, trace conversion should reject the invalid aggregate, omit it, or otherwise expose a valid finite representation rather than emitting `Infinity`.

## Impact

Telemetry backends may reject, coerce, or corrupt traces containing non-finite metric values. A context containing individually accepted usage counts can therefore make aggregate accounting unusable, produce backend-specific serialization failures, or persist misleading token totals despite passing the package's own finite input checks.
