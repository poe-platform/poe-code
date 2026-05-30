---
name: "SDK spawnCore workspace cleanup failure rejects successful provider output"
---

# SDK spawnCore workspace cleanup failure rejects successful provider output

## Summary

The SDK `spawnCore()` implementation resolves remote or writable workspace locations before invoking a provider and awaits the resolved workspace's `cleanup()` callback in a `finally` block. If the provider completes successfully but workspace cleanup rejects, the public spawn call rejects instead of returning the already obtained successful provider output.

## Reproduction

1. Add this disposable probe as `src/sdk/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  cleanup: vi.fn(async () => {
    throw new Error("workspace cleanup denied");
  }),
  resolveSpawnWorkspace: vi.fn(),
  createExecutionResources: vi.fn(() => ({ logger: { dryRun: vi.fn() } })),
  resolveActiveProviderForService: vi.fn(async () => undefined),
  buildProviderContext: vi.fn(() => ({}))
}));

vi.mock("../workspace/resolve-spawn-workspace.js", () => ({
  resolveSpawnWorkspace: mocked.resolveSpawnWorkspace
}));
vi.mock("../cli/commands/shared.js", () => ({
  createExecutionResources: mocked.createExecutionResources,
  resolveActiveProviderForService: mocked.resolveActiveProviderForService,
  buildProviderContext: mocked.buildProviderContext
}));

import { spawnCore } from "./spawn-core.js";

describe("spawnCore resolved-workspace cleanup probe", () => {
  it("rejects successful provider output solely because workspace cleanup fails", async () => {
    mocked.resolveSpawnWorkspace.mockResolvedValue({
      cwd: "/tmp/workspaces/repo",
      cleanup: mocked.cleanup
    });
    const adapter = {
      name: "mock",
      label: "Mock",
      spawn: vi.fn()
    };
    const container = {
      env: { cwd: "/repo", homeDir: "/home/test", configPath: "/home/test/config.json" },
      fs: {},
      commandRunner: vi.fn(),
      registry: {
        get: vi.fn(() => adapter),
        invoke: vi.fn(async (_name, _method, callback) =>
          callback({
            ...adapter,
            spawn: vi.fn(async () => ({ stdout: "done", stderr: "", exitCode: 0 }))
          })
        )
      }
    };

    await expect(
      spawnCore(container as never, "mock", {
        prompt: "complete",
        cwd: "github://owner/repo",
        model: "model"
      })
    ).rejects.toThrow("workspace cleanup denied");
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
✓ src/sdk/__probe__.test.ts > spawnCore resolved-workspace cleanup probe > rejects successful provider output solely because workspace cleanup fails
```

## Observed Behavior

The resolved workspace supplies a valid working directory and a cleanup callback. The mocked provider invocation completes with `{ stdout: "done", stderr: "", exitCode: 0 }`, but `spawnCore()` subsequently awaits `workspace.cleanup()` in its `finally` block. When cleanup rejects, the public operation rejects with `workspace cleanup denied` and discards the successful spawn result.

## Expected Behavior

Failure to clean up a temporary or resolved workspace after successful provider execution should not replace the authoritative provider result. The API should return the completed spawn output while surfacing cleanup trouble separately, or expose both outcomes explicitly.

## Impact

Remote-workspace deletion or synchronization cleanup failures can make an already successful agent invocation appear failed to SDK and CLI callers. Retrying the request may duplicate completed agent side effects, while users receive no normal access to the provider output that was already produced.
