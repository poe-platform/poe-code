# Agent child process close resolves before late piped output is captured

## Summary

The exported `@poe-code/agent-child-process` execution helpers finalize their result immediately when the child process emits `close`, without waiting for the piped `stdout` and `stderr` streams to finish delivering data. Output that arrives after the close event is silently omitted from a successful command result and from any follow-up agent context.

## Reproduction

Create and execute this disposable Vitest probe using an injected child-process harness, then remove it:

```sh
cat > packages/agent-child-process/src/__probe__.test.ts <<'EOF'
import { EventEmitter } from "node:events";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { execFile, type SpawnProcess } from "./index.js";

it("resolves before stdout data emitted after close is captured", async () => {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = 123;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  const spawnProcess = vi.fn(() => child as never) as unknown as SpawnProcess;

  const resultPromise = execFile("demo", { spawnProcess });
  child.emit("close", 0, null);
  child.stdout.emit("data", Buffer.from("late output"));

  await expect(resultPromise).resolves.toMatchObject({ stdout: "" });
});
EOF
npm exec -- vitest run packages/agent-child-process/src/__probe__.test.ts --reporter verbose
rm packages/agent-child-process/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/agent-child-process/src/__probe__.test.ts > resolves before stdout data emitted after close is captured
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

The injected process emits a normal successful `close` event and then emits `stdout` data from its already-attached pipe. `execFile()` resolves with `{ exitCode: 0, stdout: "" }`, even though the child stream supplies `"late output"` immediately afterward.

`exec()`, `execFile()`, and `spawn()` all collect command output through `collectResult()` in `packages/agent-child-process/src/index.ts:202` through `packages/agent-child-process/src/index.ts:243`. That function listens to `data` events on both output streams but resolves the result solely from child `error` or `close` events; it does not await stream completion or drain remaining buffered output before constructing the final attempt. This is distinct from chunk-decoding corruption or nonterminal `error` handling: an ordinary successful close alone is sufficient to freeze incomplete output.

## Expected Behavior

Command results should include all stdout and stderr data emitted by the piped child streams for that completed execution. The implementation should coordinate process termination with output-stream completion before finalizing captured results and generating any agent follow-up prompt.

## Impact

Short-lived commands and buffered child output can produce incomplete captured results even when the process exits successfully. Callers may miss final diagnostics, generated paths, or completion summaries, and any configured follow-up agent can reason from truncated command evidence while the API reports a normal successful execution.
