# SDK streaming spawn workspace cleanup failure rejects successful output

## Summary

The public SDK `spawn()` streaming API resolves writable or remote workspaces itself before creating the stream and awaits the resolved workspace's `cleanup()` callback in its result finalizer. If the streaming agent completes successfully but workspace cleanup rejects, the returned `result` promise rejects instead of returning the already completed agent output.

## Reproduction

1. Add this disposable probe as `src/sdk/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  cleanup: vi.fn(async () => {
    throw new Error("stream workspace cleanup denied");
  }),
  getSpawnConfig: vi.fn(),
  spawnStreaming: vi.fn(),
  resolveSpawnWorkspace: vi.fn()
}));

vi.mock("@poe-code/agent-spawn", () => ({
  getAcpSpawnConfig: vi.fn(),
  getSpawnConfig: mocked.getSpawnConfig,
  spawn: vi.fn(),
  spawnAcp: vi.fn(),
  spawnInteractive: vi.fn(),
  spawnStreaming: mocked.spawnStreaming,
  createSpawnParallel: vi.fn(),
  renderAcpStream: vi.fn(),
  applyMiddlewares: vi.fn((_middlewares, context) => context),
  sessionCapture: vi.fn(),
  usageCapture: vi.fn(),
  spawnLog: vi.fn(),
  runCommand: vi.fn()
}));
vi.mock("@poe-code/braintrust", () => ({ loadIntegrations: vi.fn(async () => null) }));
vi.mock("../workspace/resolve-spawn-workspace.js", () => ({
  resolveSpawnWorkspace: mocked.resolveSpawnWorkspace
}));
vi.mock("./credentials.js", () => ({ getPoeApiKey: vi.fn(async () => "test-key") }));
vi.mock("./container.js", () => ({ createSdkContainer: vi.fn(() => ({})) }));
vi.mock("../cli/commands/shared.js", () => ({
  resolveMergedDocument: vi.fn(async () => ({})),
  resolveActiveProviderForService: vi.fn()
}));
vi.mock("./spawn-core.js", () => ({
  resolveConfiguredModel: vi.fn(async () => "model"),
  spawnCore: vi.fn()
}));
vi.mock("./autonomous.js", () => ({ spawnAutonomous: vi.fn() }));

import { spawn } from "./spawn.js";

describe("SDK streaming spawn workspace cleanup probe", () => {
  it("rejects successful streaming output solely because workspace cleanup fails", async () => {
    mocked.resolveSpawnWorkspace.mockResolvedValue({ cwd: "/tmp/clone", cleanup: mocked.cleanup });
    mocked.getSpawnConfig.mockReturnValue({ kind: "cli", agentId: "codex", adapter: "codex" });
    mocked.spawnStreaming.mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "done", stderr: "", exitCode: 0 })
    });

    const { result } = spawn("codex", "complete", { cwd: "github://owner/repo" });

    await expect(result).rejects.toThrow("stream workspace cleanup denied");
    expect(mocked.cleanup).toHaveBeenCalledOnce();
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ src/sdk/__probe__.test.ts > SDK streaming spawn workspace cleanup probe > rejects successful streaming output solely because workspace cleanup fails
```

## Observed Behavior

The workspace resolver supplies a cloned working directory with a cleanup callback, and the underlying streaming spawn resolves with normal output and exit code `0`. The outer SDK `result` promise then awaits workspace cleanup; the rejected callback replaces the successful agent result with `stream workspace cleanup denied`.

## Expected Behavior

Workspace cleanup failure after a successful streaming agent invocation should not discard the completed agent output. The SDK should return the execution result while surfacing cleanup trouble separately, or expose both outcomes explicitly to callers.

## Impact

Cleanup failures for remote or temporary streaming workspaces can cause completed agent actions to be surfaced as failed. Callers may rerun work with side effects and cannot rely on the returned `result` promise to distinguish agent-execution failure from post-execution workspace cleanup trouble.
