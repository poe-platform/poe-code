# Process launcher follow bounded tail never emits new appended lines

## Summary

The exported `@poe-code/process-launcher` `followManagedLogs()` API cannot follow a current log when the caller supplies a bounded `lines` window that is already full. After each append, the next tail still has the same number of lines as the previous tail, and the implementation computes an empty delta, so newly appended output is silently never emitted even without rotation or truncation.

## Reproduction

From the repository root, create and execute this disposable in-memory Vitest probe, then remove it:

```sh
cat > packages/process-launcher/src/__probe__.test.ts <<'EOF'
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { expect, it } from "vitest";
import { followManagedLogs, type LauncherFileSystem } from "@poe-code/process-launcher";

it("never emits appended output once a bounded tail window is full", async () => {
  const baseDir = "/launch";
  const logPath = path.join(baseDir, "job", "logs", "stdout.log");
  const rawFs = createFsFromVolume(Volume.fromJSON({ [logPath]: "one\ntwo\n" }, "/")).promises;
  const fs = rawFs as unknown as LauncherFileSystem;
  const abortController = new AbortController();
  const iterator = followManagedLogs({
    baseDir,
    fs,
    id: "job",
    lines: 2,
    pollIntervalMs: 1,
    signal: abortController.signal
  })[Symbol.asyncIterator]();

  const pending = iterator.next();
  await rawFs.appendFile(logPath, "three\n", { encoding: "utf8" });
  const result = await Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve("timeout"), 20))
  ]);

  expect(result).toBe("timeout");
  abortController.abort();
  await iterator.return?.();
});
EOF
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
rm packages/process-launcher/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/process-launcher/src/__probe__.test.ts > never emits appended output once a bounded tail window is full
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

Starting with `stdout.log` containing `one` and `two`, a follower configured with `lines: 2` reads the initial tail as `['one', 'two']`. After appending `three`, the next bounded read returns `['two', 'three']`, but the iterator emits nothing and remains pending until the probe times out.

`readManagedLogs()` forwards `options.lines` into `logWriter.tail()` at `packages/process-launcher/src/launcher.ts:244` through `packages/process-launcher/src/launcher.ts:251`; `tail()` keeps only the last requested number of current-log lines at `packages/process-launcher/src/logs/log-writer.ts:147` through `packages/process-launcher/src/logs/log-writer.ts:165`. `followManagedLogs()` records the previous bounded array and computes subsequent output as `next.slice(previous.length)` at `packages/process-launcher/src/launcher.ts:254` through `packages/process-launcher/src/launcher.ts:282`. Once both arrays have length `2`, that slice begins at the end of `next`, discarding `three` despite it being newly appended.

## Expected Behavior

Following logs with a bounded initial/history window should emit future appended lines after that initial window fills. The line bound may limit retained historical context, but it must not suppress all later live output.

## Impact

CLI or SDK consumers that request a limited tail before following output can stop receiving logs as soon as the requested window is populated. Long-running managed processes then appear silent while continuing to produce output, hiding progress, diagnostics, readiness events, and failures during normal non-rotating execution.
