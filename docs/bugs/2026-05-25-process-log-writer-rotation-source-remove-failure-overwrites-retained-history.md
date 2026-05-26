# Process log writer rotation source remove failure overwrites retained history

## Summary

`@poe-code/process-launcher` rotates log files by copying each source into its destination and only then deleting the source. With `retainCount: 1`, rotation first removes the previous retained log, writes the current log content into `stdout.1.log`, and then removes `stdout.log`. If that final source removal fails, `rotate()` rejects after the old retained history has already been lost and the current run log exists in both current and rotated positions.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/logs/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import type { LauncherFileSystem } from "../types.js";
import { createLogWriter } from "./log-writer.js";

describe("process log rotation failure probe", () => {
  it("overwrites retained history before rejecting when source removal fails", async () => {
    const volume = Volume.fromJSON({
      "/logs/stdout.log": "current\n",
      "/logs/stdout.1.log": "previous\n"
    }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      ...rawFs,
      rm: async (filePath: string, options?: { force?: boolean; recursive?: boolean }) => {
        if (filePath === "/logs/stdout.log") {
          throw new Error("simulated source removal failure");
        }
        await rawFs.rm(filePath, options);
      }
    } as unknown as LauncherFileSystem;
    const writer = createLogWriter("/logs", 1, fs);

    await expect(writer.rotate()).rejects.toThrow("simulated source removal failure");
    await expect(rawFs.readFile("/logs/stdout.1.log", "utf8")).resolves.toBe("current\n");
    await expect(rawFs.readFile("/logs/stdout.log", "utf8")).resolves.toBe("current\n");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/process-launcher/src/logs/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/process-launcher/src/logs/__probe__.test.ts` afterward.

## Observed Behavior

- Before rotation, `stdout.log` contains `current` and the only retained history file `stdout.1.log` contains `previous`.
- The injected filesystem rejects only removal of `stdout.log`, after destination writes are allowed.
- `writer.rotate()` rejects with `simulated source removal failure`.
- After rejection, both `stdout.log` and `stdout.1.log` contain `current`; the original `previous` history has been destroyed.
- In `packages/process-launcher/src/logs/log-writer.ts`, `rotateStream()` removes the oldest destination before `moveIfExists()` copies the current source into `stdout.1.log`, and `moveIfExists()` removes the source only after writing the destination. A later source-removal rejection does not restore overwritten history.

## Expected Behavior

A failed log rotation should retain the prior valid log history and avoid exposing duplicated or partially rotated state. Rotation should publish its ordered log set transactionally, or restore prior destination files before reporting failure.

## Impact

A transient filesystem removal failure during process restart or manual log rotation can irreversibly erase the previous run's retained diagnostic output while still returning an error. Operators lose the historical logs most needed for debugging, and the duplicate current/rotated logs misleadingly suggest rotation succeeded in part.
