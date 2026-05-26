# ACP telemetry OTEL emits tool spans without agent parent context

## Summary

`emitToOtel()` recursively emits a root agent span and its tool child spans, but its tracer abstraction passes only a name and optional start time into `startSpan()`. It never forwards the parent span or an active parent context while recursively emitting child spans. Tool spans are therefore started as independent root spans rather than children of the agent trace.

## Reproduction

From the repository root, run a disposable Vitest probe that records each `startSpan()` invocation for a trace containing one tool child:

```sh
cat > /tmp/acp-otel-parentage-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { emitToOtel } from "./emit-otel.js";
describe("otel hierarchy", () => {
  it("starts child trace spans without a parent context", () => {
    const calls: unknown[] = [];
    const tracer = {
      startSpan(name: string, options?: unknown) {
        calls.push({ name, options });
        return { setAttribute() {}, setAttributes() {}, end() {} };
      }
    };
    emitToOtel({
      root: {
        name: "agent:codex:gpt",
        kind: "agent",
        children: [{ name: "tool_call:exec", kind: "tool", children: [] }]
      }
    }, tracer);
    console.log(JSON.stringify(calls));
    expect(calls).toEqual([
      { name: "agent:codex:gpt", options: undefined },
      { name: "tool_call:exec", options: undefined }
    ]);
  });
});
EOF
cp /tmp/acp-otel-parentage-probe.test.ts packages/acp-telemetry/src/__probe__.test.ts
trap 'rm -f packages/acp-telemetry/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-acp-telemetry-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/acp-telemetry/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-acp-telemetry-probe.config.mjs --reporter verbose
nl -ba packages/acp-telemetry/src/emit-otel.ts | sed -n '5,46p'
```

## Observed Behavior

The emitter makes two indistinguishable tracer-root start calls and supplies no parent context for the tool span:

```text
[{"name":"agent:codex:gpt"},{"name":"tool_call:exec"}]
✓ packages/acp-telemetry/src/__probe__.test.ts > otel hierarchy > starts child trace spans without a parent context
```

`AcpTraceSpan` explicitly models nested children, but `emitSpan()` in `packages/acp-telemetry/src/emit-otel.ts:15` through `packages/acp-telemetry/src/emit-otel.ts:46` recurses using only `emitSpan(child, tracer)` and invokes `tracer.startSpan(...)` without carrying the newly-created parent span or any OpenTelemetry context.

## Expected Behavior

Tool spans generated from `root.children` should be emitted under the agent span's trace context, preserving the parent/child hierarchy represented by the ACP trace model.

## Impact

OTEL backends display tool executions as unrelated root traces rather than operations inside an agent run. This breaks trace navigation, duration attribution, causal analysis, and queries intended to inspect tools used within a specific spawn.
