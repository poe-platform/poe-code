# Process launcher infinite follow poll interval reads again immediately

## Summary

The exported `@poe-code/process-launcher` `followManagedLogs()` API accepts `pollIntervalMs: Number.POSITIVE_INFINITY`. Instead of waiting indefinitely between log polls or rejecting invalid timing configuration, it schedules an overflow-coerced timer and reads newly appended log output almost immediately.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { followManagedLogs } from "./launcher.js";
import type { LauncherFileSystem } from "./types.js";

describe("process launcher infinite follow poll interval", () => {
  it("polls again immediately instead of waiting indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const fs = createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as LauncherFileSystem;
      const logPath = path.join("/state/launch", "api", "logs", "stdout.log");
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.writeFile(logPath, "old\n");

      const iterator = followManagedLogs({
        baseDir: "/state/launch",
        id: "api",
        fs,
        pollIntervalMs: Number.POSITIVE_INFINITY
      })[Symbol.asyncIterator]();
      const pending = iterator.next();
      await fs.writeFile(logPath, "old\nnew\n");

      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toEqual({ value: "new", done: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/__probe__.test.ts
```

## Observed Behavior

The iterator delivers newly appended output after advancing only one millisecond even though its configured polling interval is infinite:

```text
✓ packages/process-launcher/src/__probe__.test.ts > process launcher infinite follow poll interval > polls again immediately instead of waiting indefinitely
```

The observed iterator result is:

```json
{"value":"new","done":false,"pollIntervalMs":"Infinity"}
```

`FollowManagedLogsOptions` in `packages/process-launcher/src/launcher.ts` exposes `pollIntervalMs?: number`. `followManagedLogs()` copies the supplied value directly and calls `sleep(pollIntervalMs)` before each subsequent read. The local `sleep()` helper hands that duration to `setTimeout()` without validation. Node does not interpret `Infinity` as an indefinite sleep; it clamps the overflowing delay to an immediate timer, so log reading proceeds almost immediately instead of honoring the requested interval.

## Expected Behavior

Log-following should reject non-finite polling durations or explicitly implement a documented unbounded wait. Passing an infinite interval must not silently turn into rapid polling and immediate delivery of additional reads.

## Impact

Callers that configure an effectively disabled or paused log follower through an infinite interval instead receive active polling behavior. With persistent consumers this can drive unexpected filesystem reads and CPU activity, produce output earlier than policy intends, and make throttling or suspension configuration operate in the opposite direction from its declared value.
