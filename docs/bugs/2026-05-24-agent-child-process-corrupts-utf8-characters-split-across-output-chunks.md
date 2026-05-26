# Agent child process corrupts UTF-8 characters split across output chunks

## Summary

`@poe-code/agent-child-process` collects child `stdout` and `stderr` by converting each individual stream chunk to a string before concatenation. If Node splits a multi-byte UTF-8 character between chunks, each partial buffer is decoded independently into replacement characters, corrupting the recorded process output and any subsequent agent follow-up context.

## Reproduction

From the repository root, run a disposable Vitest probe with a fake child that emits one emoji split across multiple buffer chunks on both output streams:

```sh
cat > /tmp/agent-child-process-split-utf8-probe.test.ts <<'EOF'
import { EventEmitter } from "node:events";
import { PassThrough, type Readable, type Writable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { execFile, type SpawnProcess } from "./index.js";

interface FakeChild extends EventEmitter {
  pid: number;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill: ReturnType<typeof vi.fn>;
}

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 123;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child;
}

describe("agent-child-process UTF-8 chunking", () => {
  it("corrupts multibyte stdout and stderr characters split across chunks", async () => {
    const child = createFakeChild();
    const spawnProcess = vi.fn((() => child as unknown as ChildProcess) as SpawnProcess);
    const resultPromise = execFile("probe", { spawnProcess });
    const emoji = Buffer.from("🙂", "utf8");
    child.stdout.emit("data", emoji.subarray(0, 2));
    child.stdout.emit("data", emoji.subarray(2));
    child.stderr.emit("data", emoji.subarray(0, 1));
    child.stderr.emit("data", emoji.subarray(1));
    child.emit("close", 0, null);
    const result = await resultPromise;
    console.log(JSON.stringify({ stdout: result.stdout, stderr: result.stderr, expected: "🙂" }));
    expect(result.stdout).not.toBe("🙂");
    expect(result.stderr).not.toBe("🙂");
    expect(result.stdout).toContain("�");
    expect(result.stderr).toContain("�");
  });
});
EOF
cp /tmp/agent-child-process-split-utf8-probe.test.ts packages/agent-child-process/src/__probe__.test.ts
trap 'rm -f packages/agent-child-process/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-child-process/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The single emitted emoji is returned as replacement characters on both streams:

```text
{"stdout":"���","stderr":"����","expected":"🙂"}
✓ packages/agent-child-process/src/__probe__.test.ts > agent-child-process UTF-8 chunking > corrupts multibyte stdout and stderr characters split across chunks
```

`packages/agent-child-process/src/index.ts:222` through `packages/agent-child-process/src/index.ts:254` append `String(chunk)` separately for every `data` event. That performs independent UTF-8 decoding of incomplete `Buffer` fragments instead of using a streaming decoder or concatenating buffers before decoding.

## Expected Behavior

Captured `stdout` and `stderr` should preserve the exact UTF-8 text emitted by a child process regardless of how stream chunks divide multibyte characters.

## Impact

Process diagnostics, generated output, and the historical stdout/stderr embedded in optional agent follow-up prompts can be silently corrupted for non-ASCII text. This makes failures harder to diagnose and can alter commands or data containing international text or symbols.
