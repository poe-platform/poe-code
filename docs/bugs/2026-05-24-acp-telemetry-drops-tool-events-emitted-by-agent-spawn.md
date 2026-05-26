# ACP telemetry drops tool events emitted by agent spawn

## Summary

`@poe-code/acp-telemetry` is wired into spawn middleware contexts through the Braintrust adapter, but its trace builder creates tool spans only for `sessionUpdate: "tool_call"` and `sessionUpdate: "tool_call_update"` records. The exported agent-spawn stream and session-capture paths emit tool events in the `event: "tool_start"` / `event: "tool_complete"` shape, so real tool executions can disappear entirely from generated telemetry traces.

## Reproduction

From the repository root, run a disposable Vitest probe that passes the tool-event shape emitted by `@poe-code/agent-spawn` into `acpToTrace()`:

```sh
cat > /tmp/acp-telemetry-legacy-tool-events-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { acpToTrace } from "./trace.js";
describe("legacy ACP tool events", () => {
  it("drops tool spans from agent-spawn events", () => {
    const trace = acpToTrace({
      sessionId: "s-1",
      agent: "codex",
      prompt: "fix",
      model: "gpt",
      events: [
        { event: "tool_start", id: "call-1", kind: "exec", title: "pwd", input: { command: "pwd" } } as any,
        { event: "tool_complete", id: "call-1", kind: "exec", path: "/repo" } as any,
        { event: "agent_message", text: "done" } as any
      ],
      usage: { inputTokens: 1, outputTokens: 1 }
    } as any);
    console.log(JSON.stringify(trace));
    expect(trace.root.children).toEqual([]);
    expect(trace.root.output).toBe("done");
  });
});
EOF
cp /tmp/acp-telemetry-legacy-tool-events-probe.test.ts packages/acp-telemetry/src/__probe__.test.ts
trap 'rm -f packages/acp-telemetry/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-acp-telemetry-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/acp-telemetry/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-acp-telemetry-probe.config.mjs --reporter verbose
nl -ba packages/acp-telemetry/src/trace.ts | sed -n '26,72p;191,199p'
nl -ba packages/braintrust/src/adapters/spawn.ts | sed -n '1,34p'
nl -ba packages/agent-spawn/src/acp/middlewares/session-capture.ts | sed -n '25,92p'
```

## Observed Behavior

The root trace preserves final agent output and usage, but reports no child tool spans despite receiving one completed tool execution:

```text
{"root":{"name":"agent:codex:gpt","kind":"agent","input":{"prompt":"fix"},"output":"done","metadata":{"sessionId":"s-1"},"metrics":{"prompt_tokens":1,"completion_tokens":1,"tokens":2},"children":[]}}
✓ packages/acp-telemetry/src/__probe__.test.ts > legacy ACP tool events > drops tool spans from agent-spawn events
```

Braintrust spawn integration passes the ACP middleware context directly into `acpToTrace()` in `packages/braintrust/src/adapters/spawn.ts:12` through `packages/braintrust/src/adapters/spawn.ts:29`. Agent-spawn's session capture processes tool records in the `event: "tool_start"` and `event: "tool_complete"` shape in `packages/agent-spawn/src/acp/middlewares/session-capture.ts:25` through `packages/agent-spawn/src/acp/middlewares/session-capture.ts:92`. The telemetry builder searches exclusively for canonical session updates in `packages/acp-telemetry/src/trace.ts:50` through `packages/acp-telemetry/src/trace.ts:72` and `packages/acp-telemetry/src/trace.ts:191` through `packages/acp-telemetry/src/trace.ts:199`.

## Expected Behavior

Telemetry generated from an agent-spawn middleware context should include tool spans for the tool events that the spawn APIs actually emit, either by accepting both ACP event forms or normalizing events before trace generation.

## Impact

Braintrust traces for real agent runs can omit file edits, command executions, and MCP calls while still showing the agent response as successful. This hides operational behavior, breaks tool-level observability, and makes auditing or diagnosing agent actions unreliable.
