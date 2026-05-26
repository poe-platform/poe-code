# ACP telemetry cyclic tool output crashes trace redaction

## Summary

`acpToTrace()` accepts tool-update `rawOutput` payloads as arbitrary runtime data, but a cyclic output object crashes trace conversion during redaction. A tool result containing a self-reference throws instead of producing telemetry or a safely redacted placeholder.

## Reproduction

Create a disposable Vitest probe at `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { acpToTrace } from "./trace.js";

describe("cyclic tool output", () => {
  it("throws while converting a tool update with cyclic raw output", () => {
    const rawOutput: Record<string, unknown> = {};
    rawOutput.self = rawOutput;

    expect(() => acpToTrace({
      agent: "codex",
      prompt: "inspect output",
      events: [
        { sessionUpdate: "tool_call", toolCallId: "tool-1", kind: "read" },
        { sessionUpdate: "tool_call_update", toolCallId: "tool-1", rawOutput },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    } as never)).toThrow();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
```

The probe passes, demonstrating that trace conversion throws for a cyclic tool result payload.

## Observed Behavior

`assembleToolOutput()` preserves `rawOutput` values from tool-update events as `unknown` output data. `logToolSpans()` immediately passes that assembled value into `redact()`. Before recursing over leaves, `redact()` invokes `JSON.stringify(value)` to enforce its byte-size limit. `JSON.stringify()` throws on the cyclic `rawOutput` object, and no trace is returned.

## Expected Behavior

Telemetry conversion should tolerate cyclic arbitrary tool-output values, either by safely redacting cycles, serializing a bounded placeholder, or returning a trace with an explicit non-fatal telemetry representation. Capturing a tool result should not crash because the output graph is not JSON-serializable.

## Impact

Any tool or adapter that yields cyclic runtime output can prevent telemetry generation for the entire agent execution. This turns observability processing into a failure point, discards otherwise useful trace data, and can propagate exceptions into workflows merely attempting to record completed tool activity.
