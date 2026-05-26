# Agent Maestro negative retry backoff cap schedules immediate retry loop

## Summary

`agent-maestro` accepts a negative `agent.max_retry_backoff_ms` configuration value and uses it when scheduling failed task retries. A retry can therefore be recorded with a due time already before the current tick time, making it immediately eligible for redispatch instead of honoring any backoff delay.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/agent-maestro/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { createMockTaskList, createTask, createTickDeps } from "./__test_utils__/index.js";
import { resolveConfig } from "./config/schema.js";
import { pipelineDriver } from "./drivers/pipeline.js";
import { registerDriver } from "./drivers/registry.js";
import { tick } from "./runtime/loop.js";
import { createState } from "./runtime/state.js";

describe("negative retry backoff cap", () => {
  it("schedules a failed task retry in the past", async () => {
    registerDriver(pipelineDriver);
    const cfg = resolveConfig({
      tasks: { type: "markdown-dir", path: "/repo/tasks" },
      states: { planned: { prompt: "Do it" }, done: { terminal: true } },
      workspace: { root: "/repo/workspaces" },
      agent: { list: "tasks", max_retry_backoff_ms: -5 },
    }, "/repo");
    const task = createTask({ qualifiedId: "tasks/next", state: "planned", metadata: { createdAt: "2026-01-01T00:00:00.000Z" } });
    const state = createState(cfg);
    await tick(state, createTickDeps({
      tasks: createMockTaskList({ tasks: [task] }),
      runAttempt: async () => ({ reason: "abnormal", failure: "step_failed" }),
      now: () => 1000,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const retry = state.retry_attempts.get("tasks/next");
    console.log(JSON.stringify({ cap: cfg.agent.maxRetryBackoffMs, retry }));
    expect(retry?.dueAt).toBe(995);
  });
});
PROBE
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm packages/agent-maestro/src/__probe__.test.ts
```

Output:

```text
{"cap":-5,"retry":{"taskId":"tasks/next","attempt":2,"dueAt":995}}
✓ packages/agent-maestro/src/__probe__.test.ts > negative retry backoff cap > schedules a failed task retry in the past
```

## Observed Behavior

`resolveConfig()` accepts any finite number through `readNumber()` at `packages/agent-maestro/src/config/schema.ts:236` through `packages/agent-maestro/src/config/schema.ts:238`, preserving the negative retry cap. `backoffMs()` at `packages/agent-maestro/src/runtime/retry.ts:22` through `packages/agent-maestro/src/runtime/retry.ts:24` returns `Math.min(normalDelay, capMs)`, producing `-5`. `scheduleWorkerRetry()` at `packages/agent-maestro/src/runtime/loop.ts:372` through `packages/agent-maestro/src/runtime/loop.ts:380` then records `dueAt = 1000 + (-5)`, already in the past.

## Expected Behavior

Retry backoff caps should reject negative values or clamp them to a valid non-negative delay. A failed task must never be scheduled before the time its failure was observed, and configured retries should not bypass their intended throttling.

## Impact

An invalid workflow setting can turn repeatedly failing tasks into immediate retry churn, rapidly re-launching workers and consuming agent, API, filesystem, and logging resources without the protection of exponential backoff. This can create avoidable cost and load while obscuring the root configuration problem.
