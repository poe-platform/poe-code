# Process log writer rotation deletes concurrently appended current line

## Summary

The exported `@poe-code/process-launcher` `createLogWriter()` API does not serialize `rotate()` with `write()`. If a line is appended to the current log after rotation has read its snapshot but before it removes the current file, the newly written line is silently deleted from both current and rotated history.

## Reproduction

From the repository root, add this disposable Vitest probe at `packages/process-launcher/src/logs/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createLogWriter } from "./log-writer.js";
import type { LauncherFileSystem } from "../types.js";

describe("log rotation concurrent write", () => {
  it("deletes a line appended after rotate snapshots the current log", async () => {
    const base = createFsFromVolume(new Volume()).promises as unknown as LauncherFileSystem;
    let releaseWrite!: () => void;
    let copiedCurrent!: () => void;
    const copied = new Promise<void>((resolve) => { copiedCurrent = resolve; });
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const fs: LauncherFileSystem = {
      ...base,
      async writeFile(filePath, content) {
        await base.writeFile(filePath, content);
        if (filePath === "/logs/stdout.1.log") {
          copiedCurrent();
          await gate;
        }
      },
    };
    const writer = createLogWriter("/logs", 3, fs);
    await writer.write("old", "stdout");

    const rotating = writer.rotate();
    await copied;
    await writer.write("late", "stdout");
    releaseWrite();
    await rotating;

    const output = {
      rotated: await fs.readFile("/logs/stdout.1.log", "utf8"),
      current: await writer.tail("stdout"),
    };
    console.log(JSON.stringify(output));
    expect(output).toEqual({ rotated: "old\n", current: [] });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/process-launcher/src/logs/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"rotated":"old\n","current":[]}
✓ packages/process-launcher/src/logs/__probe__.test.ts > log rotation concurrent write > deletes a line appended after rotate snapshots the current log
```

## Observed Behavior

`createLogWriter()` is publicly exported from `packages/process-launcher/src/index.ts:15`. Its `write()` method appends directly to the current log at `packages/process-launcher/src/logs/log-writer.ts:116`, while `rotate()` delegates to `moveIfExists()` at `packages/process-launcher/src/logs/log-writer.ts:121`. `moveIfExists()` reads the current file, writes the copied snapshot to the rotated file, and only afterward deletes the source at `packages/process-launcher/src/logs/log-writer.ts:37`. The probe pauses after the snapshot has been written, appends `late\n` to `stdout.log`, and then resumes the pending removal; the new line is removed without ever appearing in `stdout.1.log`.

## Expected Behavior

Log rotation and appending through the same writer should not silently lose output. Concurrent appends should either be serialized before/after the rotation or remain visible in one of the resulting log files.

## Impact

Embedding callers that rotate logs while process output is still being delivered can lose diagnostic output at restart or maintenance boundaries. The deleted lines may include crash details, readiness messages, or security-relevant audit text, leaving both live tails and retained history incomplete with no error reported.
