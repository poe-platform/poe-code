# SDK `startLaunch` Drops a `__proto__` Daemon Environment Variable

## Summary

The public SDK `startLaunch()` API accepts caller-provided daemon environment variables but silently drops a variable named `__proto__` before spawning the managed launch daemon. Its environment normalization writes dynamic names into an ordinary object with bracket assignment.

## Reproduction

Create a disposable Vitest probe at `src/sdk/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const runnerExecMock = vi.hoisted(() => vi.fn(() => ({ pid: 42 })));

vi.mock("@poe-code/process-runner", () => ({
  createHostRunner: () => ({ exec: runnerExecMock }),
  detectEngine: () => "docker"
}));
vi.mock("@poe-code/process-launcher", () => ({
  startManagedProcess: async (options: { spawnDaemon(id: string): Promise<number> }) => {
    await options.spawnDaemon("api");
    return { id: "api" };
  },
  followManagedLogs: vi.fn(), listManagedProcesses: vi.fn(), readManagedLogs: vi.fn(),
  removeManagedProcess: vi.fn(), restartManagedProcess: vi.fn(), runManagedProcess: vi.fn(), stopManagedProcess: vi.fn()
}));
vi.mock("../utils/execution-context.js", () => ({
  getCurrentExecutionContext: () => ({ command: { command: "poe-code", args: [] } })
}));

import { startLaunch } from "./launch.js";

describe("launch SDK special environment names", () => {
  it("drops a caller-provided __proto__ environment variable for the daemon", async () => {
    await startLaunch({
      homeDir: "/home/test",
      cwd: "/repo",
      variables: JSON.parse('{"__proto__":"visible"}'),
      spec: { id: "api", command: "npm", args: ["start"] }
    } as never);

    const daemonEnv = runnerExecMock.mock.calls[0]?.[0].env as Record<string, string>;
    expect(Object.hasOwn(daemonEnv, "__proto__")).toBe(false);
    expect(daemonEnv).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run src/sdk/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the daemon environment no longer contains the accepted caller variable. Remove the disposable probe after validation.

## Observed Behavior

When `startLaunch()` receives `variables` owning `__proto__: "visible"`, the `env` object supplied to the daemon runner has no own `__proto__` field and is equal to `{}`. In `src/sdk/launch.ts`, `objectToEnv()` creates `env = {}` and copies caller variable names through `env[key] = value`; `startLaunch()` supplies that result directly to `runner.exec()`.

## Expected Behavior

The exported SDK launch API should preserve each caller-specified daemon environment variable, including a name such as `__proto__`, or reject unsupported names explicitly before starting a launch.

## Impact

SDK clients can request a launch daemon environment that differs silently from the environment actually used to start managed processes. Required daemon configuration may be unavailable at runtime with no validation error, causing hard-to-diagnose launch failures or behavior changes.
