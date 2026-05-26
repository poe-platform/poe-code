# Agent Maestro Ralph driver drops plan skills before spawn

## Summary

`@poe-code/agent-maestro` runs file-backed Ralph tasks through a bridge that converts Ralph agent invocations into `agent-spawn` calls. Ralph forwards plan-configured `skills` through its `runAgent` input, but Maestro's Ralph driver discards that field, so tasks executed under Maestro do not receive the skills configured in their Ralph plan.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/agent-maestro/src/__probe__.test.ts <<'PROBE'
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDriverContext } from "./__test_utils__/index.js";
import { createRalphDriver } from "./drivers/ralph.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});

describe("maestro Ralph skill forwarding", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("drops Ralph plan skills before calling the maestro spawn bridge", async () => {
    vol.fromJSON({ "/repo/docs/plans/plan.md": "# Plan" });
    const spawn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await options.runAgent!({
          agent: "codex",
          prompt: "Use skill",
          cwd: "/repo/workspaces/task-1",
          skills: ["security-audit"]
        });
        return { stopReason: "cancelled", docPath: options.docPath, iterationsCompleted: 0, totalDurationMs: 1 };
      }
    });

    await driver.run(createDriverContext({
      workspaceDir: "/repo/workspaces/task-1",
      planPath: "/repo/docs/plans/plan.md",
      spawn
    }));

    console.log(JSON.stringify(spawn.mock.calls[0]?.[1]));
    expect(spawn).toHaveBeenCalledWith("codex", expect.not.objectContaining({ skills: ["security-audit"] }));
  });
});
PROBE
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm packages/agent-maestro/src/__probe__.test.ts
```

Output:

```text
{"cwd":"/repo/workspaces/task-1","prompt":"Use skill"}
✓ packages/agent-maestro/src/__probe__.test.ts > maestro Ralph skill forwarding > drops Ralph plan skills before calling the maestro spawn bridge
```

## Observed Behavior

Ralph defines `skills?: string[]` on `AgentRunInput` in `packages/ralph/src/types.ts:24` through `packages/ralph/src/types.ts:33` and forwards a workflow stage's current `skills` into `runAgent` at `packages/ralph/src/run/ralph.ts:103` through `packages/ralph/src/run/ralph.ts:106`. The Maestro Ralph bridge receives that input in `packages/agent-maestro/src/drivers/ralph.ts:111` through `packages/agent-maestro/src/drivers/ralph.ts:128`, but its call to `ctx.spawn()` forwards `cwd`, `prompt`, `model`, `mode`, `hooks`, and `signal` only. In the reproduction, `options.runAgent()` receives `skills: ["security-audit"]`, while the recorded downstream spawn options contain only `cwd` and `prompt`.

## Expected Behavior

The Maestro Ralph bridge should preserve Ralph's configured agent execution inputs, including `skills`, when forwarding each plan iteration to `ctx.spawn()`.

## Impact

Ralph plans run successfully in standalone mode with configured skills, but the same plans silently execute without those skills under Maestro orchestration. Required instructions, tooling workflows, or safety/review behavior encoded as skills can be omitted without an error, producing different agent behavior depending on the entrypoint used.
