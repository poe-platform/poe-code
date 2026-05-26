# Agent child process stdout stream error is unhandled and result reports success

## Summary

The exported `@poe-code/agent-child-process` execution helpers subscribe to `data` events on child `stdout` and `stderr`, but do not subscribe to either stream's `error` event. If a child output pipe fails while the child later exits successfully, the stream error is emitted as an unhandled exception while the public `result` promise still resolves with `exitCode: 0` and empty output.

## Reproduction

Create a disposable Vitest probe at `packages/agent-child-process/src/__probe__.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { execFile, type SpawnProcess } from "./index.js";

describe("agent-child-process output stream failures", () => {
  it("leaves stdout error events unhandled after starting result collection", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcess) as unknown as SpawnProcess;

    const resultPromise = execFile("command", [], { spawnProcess });
    let thrown = "";
    try {
      child.stdout.emit("error", new Error("stdout pipe failed"));
    } catch (error) {
      thrown = (error as Error).message;
    }
    child.emit("close", 0, null);

    console.log(JSON.stringify({ thrown, result: await resultPromise }));
    expect(thrown).toBe("stdout pipe failed");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-child-process/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-child-process/src/__probe__.test.ts
```

The probe prints:

```text
{"thrown":"stdout pipe failed","result":{"kind":"execFile","command":"command","args":[],"exitCode":0,"stdout":"","stderr":"","attempts":[{"kind":"execFile","command":"command","args":[],"exitCode":0,"stdout":"","stderr":""}]}}
✓ packages/agent-child-process/src/__probe__.test.ts > agent-child-process output stream failures > leaves stdout error events unhandled after starting result collection
```

## Observed Behavior

`packages/agent-child-process/src/index.ts` publicly exports `exec()`, `execFile()`, and `spawn()`, all of which eventually collect output through `collectResult()`. That function attaches `data` listeners to `child.stdout` and `child.stderr`, then attaches completion listeners only to the child process object's `error` and `close` events. In the reproduction, `stdout.emit("error", ...)` has no listener, so Node throws the output-pipe failure synchronously. After the probe catches that thrown event and emits a successful child close, the wrapper resolves a successful result with no indication that capturing stdout failed.

## Expected Behavior

The wrapper should handle errors from piped output streams and expose them through the operation result or rejection path. A failed stdout or stderr capture must not become an uncaught process-level error while the wrapped command is subsequently reported as successful.

## Impact

Applications using these helpers for automation or agent follow-up can crash from routine pipe failures, or, if an outer handler intercepts the exception, continue with a falsely successful command result that silently lacks output. This can hide diagnostics, trigger incorrect success paths, and undermine any logic that relies on captured process output for decisions or auditing.
