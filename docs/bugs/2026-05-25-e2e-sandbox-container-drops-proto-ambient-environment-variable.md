# E2E Sandbox Container Drops a `__proto__` Ambient Environment Variable

## Summary

The exported `createSandboxContainer()` API silently drops an ambient environment variable named `__proto__` when preparing commands for sandbox execution. The host container includes ambient `process.env` values in its execution context, but the sandbox wrapper copies those keys into an ordinary object before building the sandbox command.

## Reproduction

Create a disposable Vitest probe at `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi, afterEach } from "vitest";

const buildSandboxCommandMock = vi.hoisted(() => vi.fn((_config: unknown, command: string) => ({ bin: "sandbox-bin", args: [command] })));
vi.mock("./sandbox.js", () => ({ buildSandboxCommand: buildSandboxCommandMock }));
vi.mock("./credentials.js", () => ({ getApiKey: vi.fn(async () => "key") }));
vi.mock("./runtime.js", () => ({ getWorkspaceDir: vi.fn(() => "/workspace") }));
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: "ok", stderr: "" })),
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit("close", 0); });
    return child as unknown as ChildProcess;
  })
}));

import { createSandboxContainer } from "./sandbox-container.js";

afterEach(() => { delete process.env.__proto__; });

describe("sandbox container special environment names", () => {
  it("drops an ambient __proto__ environment variable before sandbox execution", async () => {
    process.env.__proto__ = "visible";
    const container = await createSandboxContainer();
    await container.exec("echo ok");
    const sandboxEnv = buildSandboxCommandMock.mock.calls[0]?.[0].env as Record<string, string>;
    expect(Object.hasOwn(sandboxEnv, "__proto__")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that public sandbox execution discards the ambient special-name variable before command assembly. Remove the disposable probe after validation.

## Observed Behavior

After setting `process.env.__proto__ = "visible"`, calling `createSandboxContainer()` and executing a command causes `buildSandboxCommand()` to receive an environment object with no own `__proto__` entry. `buildExecEnv()` in the host container includes `process.env` in execution state, but `toSandboxEnv()` in `packages/e2e-test-runner/src/sandbox-container.ts` initializes `sandboxEnv` as `{}` and assigns each environment name through `sandboxEnv[key] = value`.

## Expected Behavior

Sandbox execution should preserve each ambient environment variable passed through the exported container API, including a data key named `__proto__`, or explicitly reject unsupported environment names rather than silently removing one.

## Impact

E2E tests running inside the sandbox can observe a different environment from the process that launched them, without any diagnostic indicating the dropped value. This can hide environment-dependent failures or invalidate tests of tools that need to forward arbitrary variables accurately.
