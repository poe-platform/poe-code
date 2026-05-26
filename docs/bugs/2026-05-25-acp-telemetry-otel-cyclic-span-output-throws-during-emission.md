# ACP telemetry OTEL cyclic span output throws during emission

## Summary

The exported `@poe-code/acp-telemetry` `emitToOtel()` API serializes non-primitive span inputs and outputs with `JSON.stringify()` without handling circular data. A caller can construct a valid public `AcpTrace` whose output contains a self-reference; emitting that trace throws a circular-structure error instead of producing telemetry or safely omitting the unserializable attribute.

## Reproduction

Create a disposable Vitest probe at `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { emitToOtel } from "./emit-otel.js";

describe("ACP OTel cyclic output", () => {
  it("throws before setting attributes when output is cyclic", () => {
    const output: { self?: unknown } = {};
    output.self = output;
    const end = vi.fn();
    const setAttributes = vi.fn();

    expect(() => emitToOtel({
      root: {
        name: "agent:codex:gpt",
        kind: "agent",
        output,
        children: []
      }
    }, {
      startSpan: () => ({ setAttribute: vi.fn(), setAttributes, end })
    })).toThrowError(/circular/i);

    expect(setAttributes).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
rm -f packages/acp-telemetry/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/acp-telemetry/src/__probe__.test.ts > ACP OTel cyclic output > throws before setting attributes when output is cyclic
```

## Observed Behavior

`emitToOtel()` throws a `TypeError` describing a circular JSON structure when the public trace contains cyclic `output` data. The span is ended in its `finally` block, but no attributes are emitted and the telemetry operation fails to return normally.

In `packages/acp-telemetry/src/emit-otel.ts:25`, emission constructs attributes before visiting child spans. `toOtelAttributes()` forwards `span.output` through `addInputOutputAttribute()` at `packages/acp-telemetry/src/emit-otel.ts:62` through `packages/acp-telemetry/src/emit-otel.ts:63`. For object output, `addInputOutputAttribute()` calls `JSON.stringify(value)` directly at `packages/acp-telemetry/src/emit-otel.ts:68` through `packages/acp-telemetry/src/emit-otel.ts:86`; a self-reference synchronously throws from that unguarded serialization call.

## Expected Behavior

Direct OpenTelemetry emission should tolerate span values that cannot be JSON-serialized, for example by omitting or safely replacing the invalid input/output attribute, or it should surface a deliberate validation error before starting trace emission. Recording telemetry for an otherwise valid trace should not crash because a runtime output object is cyclic.

## Impact

SDK callers that emit traces from arbitrary tool or agent outputs can have observability reporting throw after work has already completed. A cyclic output value turns nonessential telemetry into a failure point, discards span attributes and any remaining child-span emission, and can propagate an unexpected exception into caller workflows.
