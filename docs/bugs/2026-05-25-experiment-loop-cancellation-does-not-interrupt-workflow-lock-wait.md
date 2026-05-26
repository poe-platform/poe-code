# Experiment Loop Cancellation Does Not Interrupt Workflow Lock Wait

## Summary

`@poe-code/experiment-loop` accepts an `AbortSignal`, but it does not pass that signal to workflow lock acquisition. If another live process holds an experiment document lock, aborting a waiting experiment run does not cancel it; the operation continues retrying and eventually rejects with a lock-timeout error instead of promptly returning a cancelled result.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import * as os from "node:os";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runExperimentLoop } from "./run/loop.js";
import type { ExperimentFileSystem } from "./types.js";

describe("experiment loop cancellation while waiting for lock", () => {
  it("does not settle after its signal aborts behind a held lock", async () => {
    vi.useFakeTimers();
    const docPath = "/repo/.poe-code/experiments/plan.md";
    const volume = Volume.fromJSON({
      [docPath]: ["---", "max_experiments: 0", "---", "Plan"].join("\n"),
      [`${docPath}.lock`]: JSON.stringify({
        pid: process.pid,
        host: os.hostname(),
        acquiredAt: new Date().toISOString()
      })
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
    const controller = new AbortController();
    let settled = false;

    const run = runExperimentLoop({
      cwd: "/repo",
      homeDir: "/home/user",
      docPath,
      fs,
      runAgent: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      signal: controller.signal
    });
    const outcome = run.then(
      (result) => { settled = true; return { result }; },
      (error: unknown) => { settled = true; return { error }; }
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(outcome).resolves.toMatchObject({
      error: { message: 'Failed to acquire lock on "/repo/.poe-code/experiments/plan.md".' }
    });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/experiment-loop/src/__probe__.test.ts > experiment loop cancellation while waiting for lock > does not settle after its signal aborts behind a held lock
```

## Observed Behavior

`runExperimentLoop()` checks for an already-aborted signal at `packages/experiment-loop/src/run/loop.ts:354`, then calls `lockWorkflow()` at `packages/experiment-loop/src/run/loop.ts:355` through `packages/experiment-loop/src/run/loop.ts:357` with only the filesystem adapter. The lock implementation already supports abortable retry waits through `FileLockOptions.signal` in `packages/file-lock/src/lock.ts:16` and `packages/file-lock/src/lock.ts:276`, but the experiment loop never supplies it. In the reproduction, cancellation leaves the operation unsettled, and after its lock retries exhaust it resolves through the rejection handler with `Failed to acquire lock...` instead of a cancellation result.

## Expected Behavior

The experiment loop should pass its `AbortSignal` into lock acquisition so cancelling an experiment that is blocked behind another lock promptly aborts the wait and reaches its existing `stopReason: "cancelled"` handling instead of waiting for and reporting lock contention failure.

## Impact

Cancelled experiment jobs can remain active while waiting on another process's document lock, consuming orchestration capacity and producing a misleading failure after the user or scheduler already requested cancellation. CI systems, interactive controls, and job supervisors cannot reliably stop a queued experiment run.
