# SDK streaming spawn integration shutdown failure rejects successful output

## Summary

The public SDK `spawn()` streaming API loads optional integrations before running a streaming agent and awaits `integrations.shutdown()` in the `result` promise's `finally` block. If the agent produces a successful final result but integration shutdown rejects, `result` rejects instead of resolving with the successful agent output.

## Reproduction

1. Add this disposable probe as `src/sdk/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  shutdown: vi.fn(async () => {
    throw new Error("spawn integration shutdown denied");
  }),
  getSpawnConfig: vi.fn(),
  spawnStreaming: vi.fn(),
  loadIntegrations: vi.fn(),
  resolveSpawnWorkspace: vi.fn(async () => ({ cwd: "/repo" }))
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
vi.mock("@poe-code/braintrust", () => ({
  loadIntegrations: mocked.loadIntegrations
}));
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

describe("SDK streaming spawn integration shutdown probe", () => {
  it("rejects successful output solely because integration shutdown fails", async () => {
    mocked.loadIntegrations.mockResolvedValue({ shutdown: mocked.shutdown });
    mocked.getSpawnConfig.mockReturnValue({ kind: "cli", agentId: "codex", adapter: "codex" });
    mocked.spawnStreaming.mockReturnValue({
      events: (async function* () {})(),
      done: Promise.resolve({ stdout: "done", stderr: "", exitCode: 0 })
    });

    const { result } = spawn("codex", "complete");

    await expect(result).rejects.toThrow("spawn integration shutdown denied");
    expect(mocked.shutdown).toHaveBeenCalledOnce();
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
✓ src/sdk/__probe__.test.ts > SDK streaming spawn integration shutdown probe > rejects successful output solely because integration shutdown fails
```

## Observed Behavior

The mocked streaming agent resolves `done` with `{ stdout: "done", stderr: "", exitCode: 0 }`. After obtaining that normal output, the SDK `result` promise executes its final integration shutdown. The rejected `shutdown()` replaces the agent result with `spawn integration shutdown denied`.

## Expected Behavior

Integration shutdown failure after successful streaming agent completion should not erase the successful spawn output. The SDK should preserve the agent result while exposing telemetry or integration cleanup trouble separately, or represent both outcomes explicitly.

## Impact

Telemetry flushing or shutdown faults can make successfully completed streaming agent operations appear failed to SDK callers. Applications may retry already completed agent actions and lose access to the output they intended to consume, while a cleanup-only problem is misrepresented as execution failure.
