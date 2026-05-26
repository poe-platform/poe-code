# Process runner detached host abort kill failure becomes uncaught exception

## Summary

The exported `@poe-code/process-runner` detached host runner handles cancellation by calling `process.kill(-pid, "SIGTERM")` from an `AbortSignal` event listener without catching failures. If the detached process group no longer exists or termination otherwise throws, aborting the run raises an uncaught exception rather than resolving the run handle or reporting a controlled cancellation failure.

## Reproduction

Create this disposable probe at `packages/process-runner/src/host/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

describe("detached host runner abort failure", () => {
  it.runIf(process.platform !== "win32")(
    "raises an uncaught exception when process-group termination fails",
    async () => {
      const child = {
        pid: 321,
        stdin: null,
        stdout: null,
        stderr: null,
        kill: vi.fn(),
        once: vi.fn(() => child),
        unref: vi.fn(),
      };
      vi.resetModules();
      vi.doMock("node:child_process", () => ({ spawn: vi.fn(() => child) }));
      const processKill = vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      });
      const { createHostRunner } = await import("./host-runner.js");
      const controller = new AbortController();
      createHostRunner({ detached: true }).exec({
        command: "worker",
        signal: controller.signal,
      });

      const uncaught = new Promise<Error>((resolve) => {
        process.once("uncaughtException", (error) => resolve(error as Error));
      });
      controller.abort();

      await expect(uncaught).resolves.toMatchObject({ message: "kill ESRCH" });
      expect(processKill).toHaveBeenCalledWith(-321, "SIGTERM");
    },
  );
});
```

Run the focused probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-runner/src/host/__probe__.test.ts --reporter verbose
rm -f packages/process-runner/src/host/__probe__.test.ts
```

The probe passes:

```text
✓ packages/process-runner/src/host/__probe__.test.ts > detached host runner abort failure > raises an uncaught exception when process-group termination fails
```

## Observed Behavior

A detached run with PID `321` attaches its cancellation listener normally. When `controller.abort()` fires and a simulated Unix process-group kill throws `ESRCH`, the exception reaches `process.once("uncaughtException")`; it is not captured by the runner and is not represented by the returned handle. The probe also confirms that cancellation attempted `process.kill(-321, "SIGTERM")`.

For detached Unix children, `kill()` calls `process.kill(-child.pid, signal)` directly at `packages/process-runner/src/host/host-runner.ts:29` through `packages/process-runner/src/host/host-runner.ts:36`. The abort callback invokes that function synchronously at `packages/process-runner/src/host/host-runner.ts:44` through `packages/process-runner/src/host/host-runner.ts:46`, and `bindAbortSignal()` registers it as an `AbortSignal` event listener at `packages/process-runner/src/host/host-runner.ts:73` through `packages/process-runner/src/host/host-runner.ts:87`. No surrounding path catches a `process.kill()` exception.

This defect is separate from `docs/bugs/2026-05-26-process-runner-host-preaborted-signal-still-spawns-command.md`, which shows an already-aborted run starting before cancellation. Here a launched detached run receives cancellation, but cancellation itself becomes an uncaught process-level failure when termination cannot be delivered.

## Expected Behavior

Cancelling a detached host run should not produce an uncaught exception when its process group has already disappeared or cannot be signalled. The runner should catch termination errors and settle or report cancellation through its normal run lifecycle, treating expected missing-process cases as already stopped when appropriate.

## Impact

A normal race between detached process exit and caller cancellation can crash or destabilize the hosting Node.js process during cleanup. Workflows that abort jobs during shutdown, timeout handling, or replacement may fail outside their ordinary error channel even though the target command is already gone.
