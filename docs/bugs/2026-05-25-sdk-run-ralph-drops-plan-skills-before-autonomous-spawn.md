# SDK runRalph drops plan skills before autonomous spawn

## Summary

The public `runRalph()` SDK wrapper receives plan-configured `skills` from `@poe-code/ralph`, but its default autonomous-agent bridge does not forward that field to `spawn.autonomous()`. A normal SDK or CLI-backed Ralph run silently executes without the skills declared by the Ralph plan.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > src/sdk/__probe__.test.ts <<'PROBE'
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RalphRunOptions } from "@poe-code/ralph";

const runWorkspaceRalphMock = vi.hoisted(() => vi.fn());
const spawnAutonomousMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/ralph", () => ({ runRalph: runWorkspaceRalphMock }));
vi.mock("./spawn.js", () => ({ spawn: { autonomous: spawnAutonomousMock } }));

import { runRalph } from "./ralph.js";

describe("SDK Ralph skill forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops configured skills before invoking autonomous spawn", async () => {
    spawnAutonomousMock.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Use skill",
        cwd: "/repo",
        skills: ["security-audit"]
      });
      return { stopReason: "max_iterations", docPath: "/repo/plan.md", iterationsCompleted: 1, totalDurationMs: 1 };
    });

    await runRalph({ cwd: "/repo", homeDir: "/home/test", docPath: "/repo/plan.md" });

    console.log(JSON.stringify(spawnAutonomousMock.mock.calls[0]?.[1]));
    expect(spawnAutonomousMock).toHaveBeenCalledWith("codex", expect.not.objectContaining({ skills: ["security-audit"] }));
  });
});
PROBE
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
rm src/sdk/__probe__.test.ts
```

Output:

```text
{"prompt":"Use skill","cwd":"/repo","mode":"yolo"}
✓ src/sdk/__probe__.test.ts > SDK Ralph skill forwarding > drops configured skills before invoking autonomous spawn
```

## Observed Behavior

`@poe-code/ralph` includes `skills?: string[]` in `AgentRunInput` at `packages/ralph/src/types.ts:24` through `packages/ralph/src/types.ts:33` and passes its effective workflow-stage skills through its run-agent call at `packages/ralph/src/run/ralph.ts:103` through `packages/ralph/src/run/ralph.ts:106`. The public SDK default runner receives that input in `src/sdk/ralph.ts:38` through `src/sdk/ralph.ts:56`, but forwards only prompt, cwd, model, fixed mode, hooks, runtime fields, and signal to `sdkSpawn.autonomous()`. In the reproduction, the Ralph layer supplies `skills: ["security-audit"]`, while the recorded autonomous-spawn options contain only `prompt`, `cwd`, and `mode`.

## Expected Behavior

The public Ralph SDK bridge should preserve plan-configured execution fields, including `skills`, when invoking the autonomous agent runner.

## Impact

Plans that rely on skills for specialized instructions, validation, tooling, or safety workflows behave differently when executed through the standard SDK/CLI bridge than when directly supplied with a custom `runAgent`. The omission is silent, so users can believe required skills were active while the agent runs without them.
