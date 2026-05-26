# Process log writer infinite retention rotation never progresses

## Summary

The exported `@poe-code/process-launcher` `createLogWriter()` API accepts `retainCount: Number.POSITIVE_INFINITY`. When `rotate()` is called, its log-shifting loop repeatedly probes the same `stdout.Infinity.log` path without decrementing toward completion, so rotation never progresses unless an external operation fails or execution is interrupted.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/logs/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createLogWriter } from "./log-writer.js";
import type { LauncherFileSystem } from "../types.js";

describe("process log writer infinite retention", () => {
  it("repeats the same rotation probe instead of progressing", async () => {
    const statPaths: string[] = [];
    const halt = new Error("halt after proving repeated path");
    const fs: LauncherFileSystem = {
      readFile: vi.fn(async () => ""),
      writeFile: vi.fn(async () => undefined),
      mkdir: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
      readdir: vi.fn(async () => []),
      appendFile: vi.fn(async () => undefined),
      stat: vi.fn(async (filePath) => {
        statPaths.push(filePath);
        if (statPaths.length === 3) {
          throw halt;
        }
        return { isFile: () => false, mtimeMs: 0 };
      })
    };
    const writer = createLogWriter("/logs", Number.POSITIVE_INFINITY, fs);

    await expect(writer.rotate()).rejects.toBe(halt);
    expect(statPaths).toEqual([
      "/logs/stdout.Infinity.log",
      "/logs/stdout.Infinity.log",
      "/logs/stdout.Infinity.log"
    ]);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/process-launcher/src/logs/__probe__.test.ts --reporter verbose
rm -f packages/process-launcher/src/logs/__probe__.test.ts
```

## Observed Behavior

The bounded probe must deliberately fail the third filesystem lookup because rotation repeatedly checks exactly the same infinite-index path instead of making progress:

```text
✓ packages/process-launcher/src/logs/__probe__.test.ts > process log writer infinite retention > repeats the same rotation probe instead of progressing
```

The observed lookup sequence is:

```json
["/logs/stdout.Infinity.log","/logs/stdout.Infinity.log","/logs/stdout.Infinity.log"]
```

`createLogWriter()` in `packages/process-launcher/src/logs/log-writer.ts` calculates `maxRetainedRuns` as `Math.max(0, Math.trunc(retainCount))`, which leaves `Infinity` unchanged. `rotateStream()` first probes a rotated path at index `Infinity`, then initializes its shifting loop with `let index = maxRetainedRuns - 1`; because `Infinity - 1` is still `Infinity` and `index -= 1` also remains `Infinity`, the loop condition remains true forever and every iteration addresses the same file path.

## Expected Behavior

Log-writer construction should reject non-finite retention counts or normalize them to a documented finite behavior before rotation. `rotate()` must either complete or return a validation error; it must not enter a non-progressing asynchronous loop for an accepted option value.

## Impact

Any process supervisor or SDK consumer configured with an infinite retained-log count can hang during the first restart-driven rotation or direct `rotate()` call. The supervisor can stall after a crashed process, never launch its intended replacement, repeatedly perform filesystem operations, and leave process lifecycle state indefinitely stuck during recovery.
