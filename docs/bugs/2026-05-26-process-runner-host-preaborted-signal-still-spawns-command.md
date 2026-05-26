# Process runner host pre-aborted signal still spawns command

## Summary

The exported `@poe-code/process-runner` host runner accepts an `AbortSignal` on every `RunSpec`, but `createHostRunner().exec()` calls `child_process.spawn()` before it examines whether the supplied signal is already aborted. A caller that submits a pre-cancelled run still launches the command and only sends `SIGTERM` afterward.

## Reproduction

Create this disposable focused probe at `packages/process-runner/src/host/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

describe("host runner pre-aborted signal", () => {
  it("spawns a command before honoring an already-aborted signal", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const kill = vi.fn();
    const child = {
      pid: 123,
      stdin: null,
      stdout: null,
      stderr: null,
      kill,
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return child;
      }),
      unref: vi.fn(),
    };
    const spawnMock = vi.fn(() => child);

    vi.resetModules();
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    const { createHostRunner } = await import("./host-runner.js");

    const controller = new AbortController();
    controller.abort();
    const handle = createHostRunner().exec({
      command: "must-not-run",
      signal: controller.signal,
    });

    expect(spawnMock).toHaveBeenCalledWith("must-not-run", [], expect.any(Object));
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    listeners.get("close")?.(null);
    await expect(handle.result).resolves.toEqual({ exitCode: 1 });
  });
});
```

Run the targeted probe, then remove it:

```sh
npm exec -- vitest run packages/process-runner/src/host/__probe__.test.ts --reporter verbose
rm -f packages/process-runner/src/host/__probe__.test.ts
```

The probe passes:

```text
✓ packages/process-runner/src/host/__probe__.test.ts > host runner pre-aborted signal > spawns a command before honoring an already-aborted signal
```

## Observed Behavior

Calling `createHostRunner().exec()` with `controller.signal` after `controller.abort()` has already run still invokes the mocked process spawn for `must-not-run`. The same call subsequently invokes `child.kill("SIGTERM")`, demonstrating that cancellation is applied only after process creation.

`RunSpec.signal` is part of the shared runner API at `packages/process-runner/src/types.ts:16` through `packages/process-runner/src/types.ts:27`. In `packages/process-runner/src/host/host-runner.ts:6` through `packages/process-runner/src/host/host-runner.ts:25`, `exec()` constructs and launches the child immediately. Only after creating the result promise does it call `bindAbortSignal()` at `packages/process-runner/src/host/host-runner.ts:40` through `packages/process-runner/src/host/host-runner.ts:45`; for an already-aborted signal, `bindAbortSignal()` invokes `kill("SIGTERM")` at `packages/process-runner/src/host/host-runner.ts:73` through `packages/process-runner/src/host/host-runner.ts:87` rather than preventing the launch.

This is distinct from the retained host interactive-shell cancellation report: that issue covers `host-execution-env.shell()` dropping a shell specification's signal, whereas this reproduction exercises the public host runner directly with a signal that is forwarded but honored too late.

## Expected Behavior

A host run whose cancellation signal is already aborted at submission time should not launch its command. The runner should observe pre-cancellation before invoking `child_process.spawn()`, returning or settling a cancelled/failed handle without starting user code.

## Impact

Callers can cancel work before handing it to the host runner yet still execute the command briefly with full host privileges. Short-lived processes may complete side effects before `SIGTERM` is delivered, making cancellation unreliable for preventing writes, external requests, or destructive commands that should never have started.
