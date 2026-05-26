# Agent child process nonterminal error event completes still running child

## Summary

`@poe-code/agent-child-process` resolves a child result as failed on the first `error` event without waiting for the child's `close` event. Node child processes can emit `error` for operations against an already running process, such as a failed attempt to send a signal. In that case the exported result reports completion and freezes captured output while the child may continue running and emit additional output or later exit successfully.

## Reproduction

Create the disposable probe `packages/agent-child-process/src/__probe__.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { spawn, type SpawnProcess } from "./index.js";

describe("live child error event", () => {
  it("reports completion before a still-running child later closes", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.pid = 123;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => false);
    const spawnProcess = vi.fn(() => child as unknown as ChildProcess) as unknown as SpawnProcess;
    const handle = spawn("worker", [], { spawnProcess });

    child.emit("error", new Error("kill failed"));
    const early = await handle.result;
    child.stdout.emit("data", Buffer.from("still running output"));
    child.emit("close", 0, null);

    expect(early.exitCode).toBe(1);
    expect(early.stderr).toBe("kill failed");
    expect(early.stdout).toBe("");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-child-process/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-child-process/src/__probe__.test.ts > live child error event > reports completion before a still-running child later closes
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`collectResult()` captures output and establishes one shared `finish()` callback at `packages/agent-child-process/src/index.ts:217` through `packages/agent-child-process/src/index.ts:240`. It calls `finish(1, error)` for every child `error` event, and the `settled` guard then ignores any later `close` event at `packages/agent-child-process/src/index.ts:241` through `packages/agent-child-process/src/index.ts:242`. In the probe, the process emits an operation error while still alive, the public `result` resolves as exit code `1` with `stderr: "kill failed"`, and output emitted before its later successful close is absent from that already-finalized result.

## Expected Behavior

An `error` event that indicates the child never launched may be a terminal failed attempt, but errors emitted while an already-running child is still awaiting `close` should not alone mark process execution complete. The result should settle on actual termination while separately reporting control-operation failures, or should explicitly terminate and await the process before publishing completion.

## Impact

Cancellation, signaling, IPC, or other process-control failures can make callers believe a child command has ended when it remains active and can continue modifying files, consuming resources, or producing output. Follow-up agents and `rejectOnNonZeroExit` workflows may operate on incomplete diagnostics and race with an unmanaged command still running in the background.
