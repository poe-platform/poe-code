# SDK runRalph reusable E2B drops plan skills from agent command

## Summary

When the public Ralph SDK runs with reusable `runtime: "e2b"`, it bypasses autonomous spawn and builds each agent command directly through `buildSpawnArgs()`. That E2B branch receives Ralph plan `skills` but omits them from command construction, so remote Ralph iterations run without the skills configured by the plan.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > src/sdk/__probe__.test.ts <<'PROBE'
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RalphRunOptions } from "@poe-code/ralph";

const runWorkspaceRalphMock = vi.hoisted(() => vi.fn());
const buildSpawnArgsMock = vi.hoisted(() => vi.fn());
const createPoeCommandSessionMock = vi.hoisted(() => vi.fn());
const resolvePoeCommandExecutionMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/ralph", () => ({ runRalph: runWorkspaceRalphMock }));
vi.mock("./spawn.js", () => ({ spawn: { autonomous: vi.fn() } }));
vi.mock("./credentials.js", () => ({ getPoeApiKey: vi.fn(async () => "sk-test") }));
vi.mock("@poe-code/agent-spawn", () => ({ buildSpawnArgs: buildSpawnArgsMock }));
vi.mock("@poe-code/agent-harness-tools", () => ({
  createPoeCommandSession: createPoeCommandSessionMock,
  resolvePoeCommandExecution: resolvePoeCommandExecutionMock
}));

import { runRalph } from "./ralph.js";

describe("SDK reusable E2B Ralph skill forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits configured skills when building E2B agent command arguments", async () => {
    buildSpawnArgsMock.mockReturnValue({ binaryName: "codex", args: ["exec"] });
    resolvePoeCommandExecutionMock.mockReturnValue({
      factory: {}, state: {}, openSpec: { cwd: "/repo", runner: {} }
    });
    createPoeCommandSessionMock.mockReturnValue({
      run: vi.fn(async () => ({ kind: "sync", stdout: "", stderr: "", exitCode: 0 })),
      close: vi.fn(async () => undefined)
    });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Use skill",
        cwd: "/repo",
        skills: ["security-audit"]
      });
      return { stopReason: "max_iterations", docPath: "/repo/plan.md", iterationsCompleted: 1, totalDurationMs: 1 };
    });

    await runRalph({ cwd: "/repo", homeDir: "/home/test", docPath: "/repo/plan.md", runtime: "e2b" });

    console.log(JSON.stringify(buildSpawnArgsMock.mock.calls[0]?.[1]));
    expect(buildSpawnArgsMock).toHaveBeenCalledWith("codex", expect.not.objectContaining({ skills: ["security-audit"] }));
  });
});
PROBE
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
rm src/sdk/__probe__.test.ts
```

Output:

```text
{"prompt":"Use skill","mode":"yolo"}
✓ src/sdk/__probe__.test.ts > SDK reusable E2B Ralph skill forwarding > omits configured skills when building E2B agent command arguments
```

## Observed Behavior

Ralph includes effective plan skills in its agent input at `packages/ralph/src/run/ralph.ts:103` through `packages/ralph/src/run/ralph.ts:106`. For reusable E2B execution, `src/sdk/ralph.ts:59` through `src/sdk/ralph.ts:140` selects a separate runner that invokes `buildSpawnArgs(input.agent, ...)` at `src/sdk/ralph.ts:74` through `src/sdk/ralph.ts:79` with only `prompt`, `model`, and `mode`. Unlike normal `agent-spawn` APIs, whose option contract includes `skills` at `packages/agent-spawn/src/types.ts:53` through `packages/agent-spawn/src/types.ts:62`, this branch never passes the Ralph input's skill references into command preparation. The reproduction records an E2B command build containing `prompt` and `mode` only.

## Expected Behavior

The reusable E2B Ralph runner should preserve plan-configured `skills` when constructing each remote agent invocation, or use an equivalent bridging path that installs and activates those skills in the remote workspace.

## Impact

Ralph plans executed on reusable E2B sessions silently lose skill-driven instructions and tooling while local/docker/autonomous pathways can be configured differently. Users may select E2B specifically for isolated long-running plan execution and unknowingly run without required review, safety, or task-specific skills.
