# Superintendent Cancellation Does Not Interrupt Workflow Lock Wait

## Summary

`@poe-code/superintendent` accepts an `AbortSignal` for `runLoop()`, but does not forward it to workflow lock acquisition. When another live superintendent session owns the document lock, aborting a queued run leaves it retrying until it fails with a lock-timeout error instead of stopping promptly with its existing `"aborted"` result state.

## Reproduction

Create a disposable Vitest probe at `packages/superintendent/src/__probe__.test.ts`:

```ts
import * as os from "node:os";
import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runLoop, type SuperintendentFileSystem } from "./runtime/loop.js";

describe("superintendent cancellation while waiting for lock", () => {
  it("does not settle after abort until lock retries time out", async () => {
    vi.useFakeTimers();
    const docPath = "/repo/docs/plans/superintendent.md";
    const volume = Volume.fromJSON({
      [docPath]: "# Superintendent\n",
      [`${docPath}.lock`]: JSON.stringify({
        pid: process.pid,
        host: os.hostname(),
        acquiredAt: new Date().toISOString()
      })
    }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      readFile: (filePath: string, encoding: BufferEncoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
      writeFile: async (filePath: string, data: string) => {
        await rawFs.mkdir(path.dirname(filePath), { recursive: true });
        await rawFs.writeFile(filePath, data, "utf8");
      },
      readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
      open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
      stat: async (filePath: string) => {
        const stat = await rawFs.stat(filePath);
        return { isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory(), mtimeMs: Number(stat.mtimeMs) };
      },
      unlink: async (filePath: string) => { await rawFs.unlink(filePath); },
      mkdir: async (filePath: string, options?: { recursive?: boolean }) => { await rawFs.mkdir(filePath, options); },
      rmdir: async (filePath: string) => { await rawFs.rmdir(filePath); },
      rename: async (oldPath: string, newPath: string) => { await rawFs.rename(oldPath, newPath); }
    } as SuperintendentFileSystem;
    const controller = new AbortController();
    let settled = false;

    const outcome = runLoop({
      docPath,
      cwd: "/repo",
      homeDir: "/home/user",
      fs,
      signal: controller.signal
    }).then(
      (result) => { settled = true; return { result }; },
      (error: unknown) => { settled = true; return { error }; }
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(outcome).resolves.toMatchObject({
      error: { message: 'Failed to acquire lock on "/repo/docs/plans/superintendent.md".' }
    });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/superintendent/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/superintendent/src/__probe__.test.ts > superintendent cancellation while waiting for lock > does not settle after abort until lock retries time out
```

## Observed Behavior

`RunLoopOptions` exposes `signal?: AbortSignal` in `packages/superintendent/src/runtime/loop.ts:103` through `packages/superintendent/src/runtime/loop.ts:113`, and loop interruption logic can return `"aborted"` from `packages/superintendent/src/runtime/loop.ts:645` through `packages/superintendent/src/runtime/loop.ts:661`. However, `runLoop()` acquires its document lock at `packages/superintendent/src/runtime/loop.ts:172` through `packages/superintendent/src/runtime/loop.ts:175` with only the filesystem adapter. The shared lock implementation supports `FileLockOptions.signal`, but this signal is never supplied. The reproduction aborts a run blocked behind a live lock; it remains unsettled and later surfaces `Failed to acquire lock...`.

## Expected Behavior

`runLoop()` should pass `options.signal` into `lockWorkflow()` so cancellation interrupts lock retry waits and reaches the superintendent loop's advertised aborted outcome rather than failing after lock timeout.

## Impact

Interactive stop controls, CLI `SIGINT` handling, and schedulers can request cancellation of a queued superintendent run yet leave it active behind a locked document. Users receive delayed lock-failure errors instead of an aborted status, and occupied workers cannot be released promptly.
