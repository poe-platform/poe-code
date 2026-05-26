# Agent Maestro zero max concurrency silently stalls runnable tasks

## Summary

`agent-maestro` accepts `agent.max_concurrent_agents: 0` as valid workflow configuration and then silently declines to dispatch any runnable task on every tick. A misconfigured workflow remains active and polls normally without reporting that all work is permanently disabled.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/agent-maestro/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "./config/schema.js";
import { createState } from "./runtime/state.js";
import { tick } from "./runtime/loop.js";

describe("zero configured concurrency", () => {
  it("accepts zero then silently skips runnable dispatch", async () => {
    const cfg = resolveConfig({
      states: { ready: { prompt: "Do it" }, done: { terminal: true } },
      agent: { list: "tasks", max_concurrent_agents: 0 },
    }, "/repo");
    const state = createState(cfg);
    const ensureWorkspace = vi.fn();
    await tick(state, {
      tasks: {} as never,
      validateDispatch: async () => ({ ok: true }),
      reconcileRunning: async () => [],
      ensureWorkspace,
      runAttempt: vi.fn(),
    } as never);
    console.log(JSON.stringify({ maxConcurrentAgents: cfg.agent.maxConcurrentAgents, workspaceCalls: ensureWorkspace.mock.calls.length }));
    expect(cfg.agent.maxConcurrentAgents).toBe(0);
    expect(ensureWorkspace).not.toHaveBeenCalled();
  });
});
PROBE
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm packages/agent-maestro/src/__probe__.test.ts
```

Output:

```text
{"maxConcurrentAgents":0,"workspaceCalls":0}
✓ packages/agent-maestro/src/__probe__.test.ts > zero configured concurrency > accepts zero then silently skips runnable dispatch
```

## Observed Behavior

`resolveConfig()` preserves any finite number supplied for `max_concurrent_agents` because `readNumber()` at `packages/agent-maestro/src/config/schema.ts:236` through `packages/agent-maestro/src/config/schema.ts:238` performs no positivity/integer validation. During each scheduler tick, `packages/agent-maestro/src/runtime/loop.ts:113` through `packages/agent-maestro/src/runtime/loop.ts:116` compute zero capacity and return before fetching or dispatching active candidates, without an error or validation event.

## Expected Behavior

The workflow configuration should reject a concurrency limit below one, or explicitly surface that dispatch is disabled rather than appearing to run normally. A workflow with runnable tasks should not silently remain idle forever because of an accepted unusable scheduling limit.

## Impact

A typo or generated configuration value can cause Maestro automation to run indefinitely while performing no work, with queued tasks never advancing and no actionable failure indicating why dispatch is stopped. This wastes polling/runtime resources and can leave unattended workflows apparently healthy but permanently stuck.
