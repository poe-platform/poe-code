# ACP Telemetry OTel Emits an Inherited Session ID as a Span Attribute

## Summary

The exported `emitToOtel()` API reads identifier fields through the prototype chain of a trace span's `metadata` object. An agent span whose metadata does not own `sessionId` but inherits one is emitted with that inherited value as the `poe_code.session_id` OpenTelemetry attribute.

## Reproduction

Create a disposable Vitest probe at `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { emitToOtel } from "./emit-otel.js";

describe("OTel metadata inherited fields", () => {
  it("emits an inherited sessionId as if it were span metadata", () => {
    const setAttributes = vi.fn();
    emitToOtel({
      root: {
        name: "agent:codex:gpt",
        kind: "agent",
        metadata: Object.create({ sessionId: "inherited-session" }),
        children: []
      }
    } as never, {
      startSpan: () => ({ setAttribute: vi.fn(), setAttributes, end: vi.fn() })
    });

    expect(setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ "poe_code.session_id": "inherited-session" })
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that inherited metadata is emitted as span attribution. Remove the disposable probe after validation.

## Observed Behavior

`emitToOtel()` calls `span.setAttributes()` with `poe_code.session_id: "inherited-session"` even though `sessionId` is not an own property of `trace.root.metadata`. In `packages/acp-telemetry/src/emit-otel.ts`, `toOtelAttributes()` reads `span.metadata?.sessionId` and `span.metadata?.threadId` directly without requiring own metadata fields.

## Expected Behavior

Telemetry emission should use only explicitly present trace metadata fields as identifiers, or normalize trace data before emission so inherited prototype properties cannot become OpenTelemetry session or thread attribution.

## Impact

Malformed or prototype-influenced trace inputs can inject misleading session attribution into emitted spans. Downstream telemetry can associate activity with a session identifier that was never explicitly included in the trace record, compromising correlation and audit accuracy.
