# SDK runRalph reusable E2B disables per-plan run log routing

## Summary

The public Ralph SDK uses a special reusable-session path for `runtime: "e2b"`. Although Ralph supplies a per-plan `logDir` and `logFileName` for every iteration, that E2B path neither transports those values into remote execution nor enables its command log tee; it explicitly constructs execution with `wrapForLogTee: false`.

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
vi.mock("./credentials.js", () => ({ getPoeApiKey: vi.fn(async () => "test-key") }));
vi.mock("@poe-code/agent-spawn", () => ({ buildSpawnArgs: buildSpawnArgsMock }));
vi.mock("@poe-code/agent-harness-tools", () => ({
  createPoeCommandSession: createPoeCommandSessionMock,
  resolvePoeCommandExecution: resolvePoeCommandExecutionMock
}));

import { runRalph } from "./ralph.js";

describe("SDK reusable E2B Ralph log routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a remote run with log tee disabled despite Ralph log routing", async () => {
    buildSpawnArgsMock.mockReturnValue({ binaryName: "codex", args: ["exec"] });
    resolvePoeCommandExecutionMock.mockImplementation((input) => ({
      factory: {}, state: {}, openSpec: { cwd: input.cwd, execution: input.openSpec.execution, runner: {} }
    }));
    createPoeCommandSessionMock.mockReturnValue({
      run: vi.fn(async () => ({ kind: "sync", stdout: "", stderr: "", exitCode: 0 })),
      close: vi.fn(async () => undefined)
    });
    runWorkspaceRalphMock.mockImplementationOnce(async (options: RalphRunOptions) => {
      await options.runAgent?.({
        agent: "codex",
        prompt: "Track output",
        cwd: "/repo",
        logDir: "/home/test/.poe-code/ralph/runs/plan",
        logFileName: "iteration.jsonl"
      });
      return { stopReason: "max_iterations", docPath: "/repo/plan.md", iterationsCompleted: 1, totalDurationMs: 1 };
    });

    await runRalph({ cwd: "/repo", homeDir: "/home/test", docPath: "/repo/plan.md", runtime: "e2b" });

    const request = resolvePoeCommandExecutionMock.mock.calls[0]?.[0];
    console.log(JSON.stringify({ wrapForLogTee: request.openSpec.execution.wrapForLogTee, hasLogRouting: "logDir" in request || "logFileName" in request }));
    expect(request.openSpec.execution).toMatchObject({ wrapForLogTee: false, captureOutput: true });
    expect(request).not.toEqual(expect.objectContaining({ logDir: expect.anything(), logFileName: expect.anything() }));
  });
});
PROBE
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
rm src/sdk/__probe__.test.ts
```

Output:

```text
{"wrapForLogTee":false,"hasLogRouting":false}
✓ src/sdk/__probe__.test.ts > SDK reusable E2B Ralph log routing > builds a remote run with log tee disabled despite Ralph log routing
```

## Observed Behavior

Ralph computes and passes its intended iteration log destination through `logDir` and `logFileName` at `packages/ralph/src/run/ralph.ts:41` through `packages/ralph/src/run/ralph.ts:47` and `packages/ralph/src/run/ralph.ts:87` through `packages/ralph/src/run/ralph.ts:107`. The reusable E2B runner in `src/sdk/ralph.ts:59` through `src/sdk/ralph.ts:140` does not read those two input fields. Instead, it prepares remote execution with `wrapForLogTee: false` and captured stdio at `src/sdk/ralph.ts:98` through `src/sdk/ralph.ts:107`, then runs the reusable session. In the reproduction, the execution request contains no Ralph log-routing fields and expressly disables the shared command tee mechanism.

## Expected Behavior

Reusable E2B Ralph execution should preserve the plan-scoped log routing selected by Ralph, either by writing captured iteration output into `logDir`/`logFileName` or by enabling an equivalent remote/log-download mechanism tied to that destination.

## Impact

Ralph plans run in reusable E2B sessions cannot rely on their plan-specific iteration logs even though the core allocates those paths. Remote executions may produce captured output for immediate return while leaving Ralph's expected historical log location empty, impairing post-run debugging, audit trails, and replayability for isolated long-running runs.
