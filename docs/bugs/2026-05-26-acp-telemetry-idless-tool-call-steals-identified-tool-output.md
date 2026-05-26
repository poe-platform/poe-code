# ACP telemetry id-less tool call steals identified tool output

## Summary

The exported `@poe-code/acp-telemetry` `acpToTrace()` converter accepts ACP `tool_call` events without a string `toolCallId`, but then treats every later `tool_call_update` as belonging to that uncorrelated tool span. If a later normal tool call has its own identifier and produces output, the earlier id-less span duplicates that output as though it were its own result.

## Reproduction

From the repository root, create and execute this disposable Vitest probe, then remove it:

```sh
cat > packages/acp-telemetry/src/__probe__.test.ts <<'EOF'
import type { AcpEvent, AcpSpawnContext } from "@poe-code/agent-spawn";
import { expect, it } from "vitest";
import { acpToTrace } from "./trace.js";

it("attributes later identified tool output to an earlier id-less tool call", () => {
  const events = [
    { sessionUpdate: "tool_call", kind: "read", rawInput: { path: "a.txt" } },
    { sessionUpdate: "tool_call", toolCallId: "tc-2", kind: "execute", rawInput: { command: "pwd" } },
    { sessionUpdate: "tool_call_update", toolCallId: "tc-2", rawOutput: "workspace" }
  ] as unknown as AcpEvent[];
  const context = {
    agent: "codex",
    model: "gpt-5",
    prompt: "inspect",
    mode: "read",
    cwd: "/repo",
    sessionId: "session-1",
    threadId: "thread-1",
    events,
    usage: {}
  } as unknown as AcpSpawnContext;

  const trace = acpToTrace(context);

  expect(trace.root.children.map((span) => span.output)).toEqual(["workspace", "workspace"]);
});
EOF
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
rm -f packages/acp-telemetry/src/__probe__.test.ts
```

The focused probe passes:

```text
✓ packages/acp-telemetry/src/__probe__.test.ts > attributes later identified tool output to an earlier id-less tool call
```

## Observed Behavior

The generated trace contains two child tool spans and both report `"workspace"` as output, even though only the second `tool_call` (`toolCallId: "tc-2"`) has a matching update. `logToolSpans()` reads an absent/non-string `toolCallId` as `undefined` at `packages/acp-telemetry/src/trace.ts:50` through `packages/acp-telemetry/src/trace.ts:69`. Both `collectToolMeta()` and `assembleToolOutput()` then filter updates only when the starting call has a defined identifier at `packages/acp-telemetry/src/trace.ts:74` through `packages/acp-telemetry/src/trace.ts:99` and `packages/acp-telemetry/src/trace.ts:124` through `packages/acp-telemetry/src/trace.ts:160`; for an id-less start, every subsequent tool update is included.

## Expected Behavior

A tool call that cannot be correlated by identifier should not absorb updates explicitly identified as belonging to another tool call. The converter should reject malformed/unidentifiable starts, leave their output uncorrelated, or match only compatible id-less updates without duplicating later identified tool results.

## Impact

Malformed or partially populated ACP event streams produce misleading tool traces: one real tool output can be duplicated onto an unrelated earlier span, and the same permissive matching also allows unrelated update metadata and timestamps to contaminate that span. This undermines debugging, latency attribution, and auditability in emitted Braintrust or OpenTelemetry traces.
