# Agent Maestro configured max turns is never applied to pipeline agent

## Summary

`agent-maestro` documents `agent.max_turns` as the maximum turns passed to each spawned agent execution and parses it into resolved configuration, but the pipeline driver never supplies that value to `spawn()`. Changing `max_turns` therefore has no effect on pipeline agent executions.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/agent-maestro/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it, vi } from "vitest";
import { createConfig, createTask } from "./__test_utils__/index.js";
import { pipelineDriver } from "./drivers/pipeline.js";

describe("configured max turns", () => {
  it("parses maxTurns but never forwards it to pipeline agent spawn", async () => {
    const spawn = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, threadId: "thread" });
    const cfg = createConfig({ agent: { maxTurns: 1 } });
    await pipelineDriver.run({
      task: createTask({ state: "planned" }),
      attempt: 1,
      workspaceDir: "/repo/workspaces/task",
      planPath: null,
      cfg,
      abort: new AbortController().signal,
      emit: vi.fn(),
      spawn,
      refreshTask: async () => createTask({ state: "planned" }),
      reconcile: async () => "continue",
      logger: { warn: vi.fn() },
    });
    console.log(JSON.stringify({ maxTurns: cfg.agent.maxTurns, spawnOptions: spawn.mock.calls[0]?.[1] }));
    expect(cfg.agent.maxTurns).toBe(1);
    expect(spawn.mock.calls[0]?.[1]).not.toHaveProperty("maxTurns");
  });
});
PROBE
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm packages/agent-maestro/src/__probe__.test.ts
```

Output:

```text
{"maxTurns":1,"spawnOptions":{"prompt":"Plan tasks/task-1: Build runner\n\nRender this task body","mode":"yolo","signal":{}}}
✓ packages/agent-maestro/src/__probe__.test.ts > configured max turns > parses maxTurns but never forwards it to pipeline agent spawn
```

## Observed Behavior

The resolved configuration carries `maxTurns: 1`, but the pipeline driver's `spawn()` options contain only the prompt, mode, and abort signal. `packages/agent-maestro/src/config/schema.ts:90` through `packages/agent-maestro/src/config/schema.ts:92` expose `maxTurns`; `packages/agent-maestro/README.md:52` states that `max_turns` is passed to each spawned agent execution; yet `packages/agent-maestro/src/drivers/pipeline.ts:108` through `packages/agent-maestro/src/drivers/pipeline.ts:115` do not read or forward `ctx.cfg.agent.maxTurns`.

## Expected Behavior

Setting `agent.max_turns` should constrain each pipeline-spawned agent execution according to the package's documented configuration contract, or the unsupported configuration field should not be exposed and documented as active behavior.

## Impact

Workflow operators may set small turn limits to bound latency, cost, or autonomous execution risk, while Maestro silently runs pipeline agents without applying that configured limit. Resource budgets and operational safety assumptions based on the documented setting are not enforced.
