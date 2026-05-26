# Process launcher follow logs drops new output after log rotation

## Summary

The exported `followManagedLogs()` implementation tracks only the previous number of lines in the current log file and obtains new output with `next.slice(previous.length)`. When a managed process restart rotates the old log and creates a shorter new `stdout.log`, the follower treats the new file as though it were a truncated continuation and silently skips its initial output.

## Reproduction

From the repository root, start following a current two-line log, then simulate the normal rotation performed on restart by moving those historical lines into `stdout.1.log` and replacing `stdout.log` with one fresh line:

```sh
cat > /tmp/process-launcher-follow-rotation-probe.mjs <<'EOF'
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { followManagedLogs } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

const root = await mkdtemp(path.join(os.tmpdir(), "follow-rotation-"));
const logDir = path.join(root, "job", "logs");
await mkdir(logDir, { recursive: true });
await writeFile(path.join(logDir, "stdout.log"), "old-1\nold-2\n");

const abortController = new AbortController();
const iterator = followManagedLogs({
  baseDir: root,
  id: "job",
  stream: "stdout",
  pollIntervalMs: 10,
  signal: abortController.signal
})[Symbol.asyncIterator]();
const pending = iterator.next();
await new Promise((resolve) => setTimeout(resolve, 2));
await writeFile(path.join(logDir, "stdout.1.log"), "old-1\nold-2\n");
await writeFile(path.join(logDir, "stdout.log"), "new-1\n");

const result = await Promise.race([
  pending,
  new Promise((resolve) => setTimeout(() => resolve("timeout"), 50))
]);
console.log(`result=${JSON.stringify(result)}`);
abortController.abort();
await iterator.return();
EOF

node /tmp/process-launcher-follow-rotation-probe.mjs

nl -ba packages/process-launcher/src/logs/log-writer.ts | sed -n '121,154p'
nl -ba packages/process-launcher/src/launcher.ts | sed -n '244,282p'
```

## Observed Behavior

The follower does not produce `new-1`; it remains pending until the probe times out:

```text
result="timeout"
```

`packages/process-launcher/src/logs/log-writer.ts:121` through `packages/process-launcher/src/logs/log-writer.ts:145` rotate the former current file to `stdout.1.log` and create a fresh current log for the new run. `packages/process-launcher/src/launcher.ts:254` through `packages/process-launcher/src/launcher.ts:282` retain the prior current file's lines and compute updates as `next.slice(previous.length)`. In this reproduction `previous.length` is `2` while the replacement current file contains only one new line, so its entire content is discarded.

## Expected Behavior

A log follower should detect rotation or truncation and emit lines from a replacement current log starting at its beginning, while avoiding duplicate delivery from unchanged appended logs. Restarting a managed process must not make the first output from the new run disappear.

## Impact

Users following process output through restarts can miss startup diagnostics, crash reasons, and readiness messages from the replacement process. Because the iterator simply waits for later appended lines, the data loss is silent and can make a failed restart appear to have produced no output.
