# Process Log Writer Zero Retention Stderr Removal Failure Leaves Stdout Erased

## Summary

The exported `@poe-code/process-launcher` log writer clears retained logs one stream at a time when `retainCount` is zero. If removing stderr logs fails after stdout cleanup succeeds, `rotate()` rejects while all stdout history has already been erased and stderr history remains, leaving an inconsistent partially cleared log set.

## Reproduction

Create a disposable probe at `packages/process-launcher/src/logs/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { LauncherFileSystem } from "../types.js";
import { createLogWriter } from "./log-writer.js";

describe("zero-retention log clearing failure probe", () => {
  it("leaves stdout logs deleted when stderr current-log removal rejects", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises as unknown as LauncherFileSystem;
    await fs.mkdir("/logs", { recursive: true });
    await fs.writeFile("/logs/stdout.log", "stdout current\n");
    await fs.writeFile("/logs/stdout.1.log", "stdout old\n");
    await fs.writeFile("/logs/stderr.log", "stderr current\n");
    const originalRm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementation(async (filePath, options) => {
      if (filePath === "/logs/stderr.log") {
        throw new Error("injected stderr removal failure");
      }
      return originalRm(filePath, options);
    });

    await expect(createLogWriter("/logs", 0, fs).rotate()).rejects.toThrow(
      "injected stderr removal failure"
    );
    await expect(fs.readFile("/logs/stdout.log", "utf8")).rejects.toThrow();
    await expect(fs.readFile("/logs/stdout.1.log", "utf8")).rejects.toThrow();
    await expect(fs.readFile("/logs/stderr.log", "utf8")).resolves.toBe("stderr current\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/process-launcher/src/logs/__probe__.test.ts --reporter verbose
```

The probe passes, proving that stdout cleanup is committed before later stderr cleanup fails. Remove the disposable probe afterward.

## Observed Behavior

`createLogWriter("/logs", 0, fs).rotate()` rejects with `injected stderr removal failure`, but both `stdout.log` and `stdout.1.log` are already deleted. `stderr.log` remains unchanged because its removal triggered the failure, leaving only one stream's history retained from the failed zero-retention rotation.

## Expected Behavior

Zero-retention cleanup should remove stdout and stderr histories as one coherent state transition, or preserve the original logs if clearing either stream fails. A rejected rotation should not silently destroy only one stream's logs.

## Impact

A filesystem or permission failure while clearing process logs can permanently discard stdout diagnostics while preserving stderr, despite the caller receiving an error. Subsequent troubleshooting sees an incomplete and misleading history for the same managed run, making failure diagnosis and audit reconstruction unreliable.
