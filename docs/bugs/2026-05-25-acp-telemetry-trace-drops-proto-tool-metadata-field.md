# ACP telemetry trace drops proto tool metadata field

## Summary

The exported `@poe-code/acp-telemetry` `acpToTrace()` API silently drops an explicit tool metadata field named `__proto__`. A valid ACP tool-call event containing that own `_meta` key converts successfully, but the corresponding child trace span has no metadata payload at all.

## Reproduction

From the repository root, add a disposable probe at `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { acpToTrace } from "./trace.js";

describe("ACP tool metadata special keys", () => {
  it("drops an explicit __proto__ tool metadata field from the trace", () => {
    const trace = acpToTrace({
      agent: "codex",
      model: "gpt",
      prompt: "inspect",
      cwd: "/repo",
      usage: { inputTokens: 1, outputTokens: 1 },
      events: [
        { event: "tool_start", kind: "exec", id: "tool-1", _meta: JSON.parse('{"__proto__":{"marker":"lost"}}') }
      ]
    } as never);

    expect(trace.root.children[0]?.metadata).toBeUndefined();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/acp-telemetry/src/__probe__.test.ts > ACP tool metadata special keys > drops an explicit __proto__ tool metadata field from the trace
```

Remove the disposable probe after running it.

## Observed Behavior

`acpToTrace()` returns a child tool span with `metadata === undefined` for an event whose `_meta` object owns a `__proto__` value. `collectToolMeta()` in `packages/acp-telemetry/src/trace.ts` initializes `merged` as `{}` and copies event metadata through `merged[key === "ts" ? "startTs" : key] = value` and the analogous update loop. The `__proto__` write changes the intermediate metadata object's prototype; because it adds no enumerable own field, the converter then treats metadata as empty and omits it from the trace.

## Expected Behavior

Trace conversion should preserve each accepted own tool metadata field as inert trace metadata, including a data key such as `__proto__`, or explicitly reject unsupported metadata names. A valid event field must not disappear while conversion reports success.

## Impact

Telemetry output can silently omit tool metadata supplied by ACP events, reducing trace fidelity and hiding diagnostic or correlation information. Any downstream Braintrust or OpenTelemetry emission receives an incomplete trace even though the source event contained the field.
