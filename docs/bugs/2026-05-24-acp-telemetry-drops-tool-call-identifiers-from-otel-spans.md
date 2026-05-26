# ACP telemetry drops tool call identifiers from OTEL spans

## Summary

`@poe-code/acp-telemetry` receives required ACP `toolCallId` values on normal `tool_call` events and uses them internally to pair tool outputs, but it never carries those identifiers into the resulting trace span metadata. `emitToOtel()` therefore cannot emit its defined `poe_code.tool_call_id` attribute for traces produced by `acpToTrace()`.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/acp-telemetry/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { acpToTrace } from "./trace.js";
import { emitToOtel, type OtelSpanLike } from "./emit-otel.js";

describe("tool-call id OTEL propagation", () => {
  it("drops the protocol toolCallId from emitted OTEL attributes", () => {
    const records: Array<{ name: string; attrs?: Record<string, unknown> }> = [];
    const tracer = {
      startSpan(name: string): OtelSpanLike {
        const record: { name: string; attrs?: Record<string, unknown> } = { name };
        records.push(record);
        return {
          setAttribute() {},
          setAttributes(attrs) { record.attrs = attrs; },
          end() {},
        };
      },
    };
    const trace = acpToTrace({
      agent: "codex",
      model: "gpt",
      prompt: "run",
      events: [
        { sessionUpdate: "tool_call", toolCallId: "call-123", title: "Read", kind: "read", input: { path: "a" } },
        { sessionUpdate: "tool_call_update", toolCallId: "call-123", rawOutput: "done" },
      ],
      usage: {},
    } as never);

    emitToOtel(trace, tracer);
    console.log(JSON.stringify(records));
    expect(records[1]?.attrs).not.toHaveProperty("poe_code.tool_call_id");
  });
});
PROBE
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
rm packages/acp-telemetry/src/__probe__.test.ts
```

Output:

```text
[{"name":"agent:codex:gpt","attrs":{"gen_ai.system":"poe-code","gen_ai.request.model":"gpt","gen_ai.agent.name":"codex","poe_code.input":"{\"prompt\":\"run\"}","poe_code.output":""}},{"name":"tool_call:read","attrs":{"gen_ai.tool.name":"read","poe_code.input":"{\"path\":\"a\"}","poe_code.output":"done"}}]
✓ packages/acp-telemetry/src/__probe__.test.ts > tool-call id OTEL propagation > drops the protocol toolCallId from emitted OTEL attributes
```

## Observed Behavior

ACP tool events define `toolCallId` as a required identifier in `packages/agent-spawn/src/acp/types.ts:53` through `packages/agent-spawn/src/acp/types.ts:75`. `acpToTrace()` reads this identifier only to associate updates in `packages/acp-telemetry/src/trace.ts:59` through `packages/acp-telemetry/src/trace.ts:64`, but the created child span metadata contains only values copied from `_meta`, never the event's `toolCallId`. `emitToOtel()` explicitly maps `span.metadata?.toolCallId` to `poe_code.tool_call_id` at `packages/acp-telemetry/src/emit-otel.ts`, so ordinary converted ACP traces omit the attribute even when each source tool event is correctly identified.

## Expected Behavior

`acpToTrace()` should preserve each required protocol `toolCallId` in its corresponding tool span metadata so `emitToOtel()` emits `poe_code.tool_call_id` for normal tool executions and downstream trace consumers can correlate spans with ACP events.

## Impact

OTEL traces generated through the public ACP-to-trace pipeline lose the stable correlation key for tool invocations. Observability consumers cannot reliably join tool spans back to ACP updates or distinguish repeated concurrent calls of the same tool using the documented telemetry attribute.
