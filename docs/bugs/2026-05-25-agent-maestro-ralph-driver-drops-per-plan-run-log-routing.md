# Agent Maestro Ralph driver drops per-plan run log routing

## Summary

`@poe-code/ralph` supplies a dedicated per-plan run-log directory and filename through each agent invocation. When Ralph plans run through `@poe-code/agent-maestro`, the Ralph driver omits both log-routing fields before calling its downstream spawn adapter, so Maestro-run Ralph output is not sent to Ralph's intended plan-specific log location.

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

describe("maestro Ralph run-log forwarding", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("drops Ralph run log routing before calling spawn", async () => {
    vol.fromJSON({ "/repo/docs/plans/plan.md": "# Plan" });
    const spawn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const driver = createRalphDriver({
      runRalph: async (options) => {
        await options.runAgent!({
          agent: "codex",
          prompt: "Track output",
          cwd: "/repo/workspaces/task-1",
          logDir: "/home/test/.poe-code/ralph/runs/plan",
          logFileName: "20260525-010000-000-codex.jsonl"
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
    expect(spawn).toHaveBeenCalledWith("codex", expect.not.objectContaining({
      logDir: "/home/test/.poe-code/ralph/runs/plan",
      logFileName: "20260525-010000-000-codex.jsonl"
    }));
  });
});
PROBE
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm packages/agent-maestro/src/__probe__.test.ts
```

Output:

```text
{"cwd":"/repo/workspaces/task-1","prompt":"Track output"}
✓ packages/agent-maestro/src/__probe__.test.ts > maestro Ralph run-log forwarding > drops Ralph run log routing before calling spawn
```

## Observed Behavior

Ralph computes its run log destination at `packages/ralph/src/run/ralph.ts:41` through `packages/ralph/src/run/ralph.ts:47` and includes `logDir` plus `logFileName` in each executor input at `packages/ralph/src/run/ralph.ts:87` through `packages/ralph/src/run/ralph.ts:107`. Those fields are part of the public input contract at `packages/ralph/src/types.ts:23` through `packages/ralph/src/types.ts:40`. The Maestro Ralph driver receives the input but invokes `ctx.spawn()` at `packages/agent-maestro/src/drivers/ralph.ts:111` through `packages/agent-maestro/src/drivers/ralph.ts:128` with only cwd, prompt, model, mode, hooks, and signal. In the reproduction, its downstream spawn options omit both Ralph log-routing values.

## Expected Behavior

The Maestro Ralph driver should preserve Ralph's `logDir` and `logFileName` when bridging plan iterations into its agent spawn mechanism, so Ralph plan runs retain their intended output history layout under orchestration.

## Impact

Ralph plans run under Maestro can lose their plan-scoped iteration logs or write output only to default/general spawn locations. Operators debugging orchestrated plan execution cannot reliably locate the logs Ralph deliberately allocated for that plan, reducing auditability and replay/debug usefulness.
