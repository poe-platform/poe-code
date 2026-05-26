# Agent harness tools log since filter returns historical bytes after recent append

## Summary

`@poe-code/agent-harness-tools` implements the `JobHandle.stream({ since })` filter by comparing the whole log file's modification time against the requested timestamp. Once any recent append updates that mtime, the stream reads from its ordinary byte offset of zero and emits all earlier historical output along with the new content. A request for recent logs can therefore return output created before the requested timestamp.

## Reproduction

Create the disposable probe `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { streamLogFile, type LogStreamFs } from "./log-stream.js";

describe("timestamp filtered log stream", () => {
  it("returns historical bytes when a file receives one recent append", async () => {
    const since = new Date("2026-05-25T10:00:00.000Z");
    const fs: LogStreamFs = {
      promises: {
        async stat() { return { mtimeMs: since.getTime() + 1 }; },
        async readFile() { return Buffer.from("old output\nnew output\n"); }
      }
    };
    const iterator = streamLogFile({ fs }, "job-1", { since })[Symbol.asyncIterator]();

    const first = await iterator.next();

    expect(first.value).toEqual({ byteOffset: 0, data: "old output\nnew output\n" });
    await iterator.return?.();
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > timestamp filtered log stream > returns historical bytes when a file receives one recent append
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`streamLogFile()` initializes `byteOffset` from `sinceByte` alone, defaulting to zero, and uses `wasModifiedSince()` only as a gate before reading a chunk at `packages/agent-harness-tools/src/log-stream.ts:37` through `packages/agent-harness-tools/src/log-stream.ts:60`. `wasModifiedSince()` considers the whole file eligible whenever its single `mtimeMs` is at least the requested timestamp at `packages/agent-harness-tools/src/log-stream.ts:63` through `packages/agent-harness-tools/src/log-stream.ts:76`. `readLogChunk()` then emits all bytes from offset zero at `packages/agent-harness-tools/src/log-stream.ts:111` through `packages/agent-harness-tools/src/log-stream.ts:127`. In the probe, a file marked as recently modified returns both `old output` and `new output` when requested with `since`.

## Expected Behavior

A timestamp-filtered log request should not return bytes known to predate the requested time. If append-only log files cannot map timestamps to byte offsets precisely, the contract should avoid presenting `since` as an output filter or require a compatible offset so historical log contents are not silently included.

## Impact

Users requesting recent detached-job logs can receive stale output whenever a long-lived log file has any new activity. Earlier errors, prompts, secret-bearing diagnostics, or outdated progress can be replayed into CLI output and model-visible context despite the user selecting a recent time window, producing misleading troubleshooting and over-broad log disclosure.
