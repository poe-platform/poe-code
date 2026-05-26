# Process state remove directory failure rejects after erasing process artifacts

## Summary

`@poe-code/process-launcher`'s exported state store removes a managed process directory recursively by deleting all nested files before removing the now-empty directories. If the final removal of the process directory fails, `StateStore.remove()` rejects after the persisted process state and log artifacts have already been erased. The caller receives a failed cleanup result even though the essential tracked process contents are no longer recoverable through the state store.

## Reproduction

Create a disposable Vitest probe at `packages/process-launcher/src/state/__probe__.test.ts`:

```ts
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import type { LauncherFileSystem } from "../types.js";
import { createStateStore } from "./state-store.js";

describe("process state remove failure probe", () => {
  it("deletes persisted process contents before rejecting final directory removal", async () => {
    const processDir = "/state/alpha";
    const volume = Volume.fromJSON({
      [path.join(processDir, "state.json")]: '{"id":"alpha"}\n',
      [path.join(processDir, "logs/stdout.log")]: "hello\n"
    }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      ...rawFs,
      rmdir: async (directoryPath: string) => {
        if (directoryPath === processDir) {
          throw new Error("simulated final directory removal failure");
        }
        await rawFs.rmdir(directoryPath);
      }
    } as unknown as LauncherFileSystem;
    const store = createStateStore("/state", fs);

    await expect(store.remove("alpha")).rejects.toThrow(
      "simulated final directory removal failure"
    );
    await expect(rawFs.readFile(path.join(processDir, "state.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(rawFs.readFile(path.join(processDir, "logs/stdout.log"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.read("alpha")).resolves.toBeNull();
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/process-launcher/src/state/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/process-launcher/src/state/__probe__.test.ts` afterward.

## Observed Behavior

- The process state directory initially contains both `state.json` and nested `logs/stdout.log`.
- The injected filesystem permits removal of nested files and the log directory, but rejects removal of the top-level process directory.
- `store.remove("alpha")` rejects with `simulated final directory removal failure`.
- After rejection, both persisted artifact files are absent, and `store.read("alpha")` returns `null`; only an empty/partially cleaned directory may remain.
- In `packages/process-launcher/src/state/state-store.ts`, `removeDirectory()` recursively removes every file and child directory before calling `rmdir(directoryPath)` for the top-level process directory, with no rollback or committed-result semantics if that final call fails.

## Expected Behavior

A failed state removal should not ambiguously report failure after irreversibly erasing the process record and logs. The operation should either reliably complete cleanup, surface a partial-success result, or use deletion semantics that do not leave callers believing tracked state remains recoverable after rejection.

## Impact

Permission, handle, or filesystem failures on the final directory operation can make process cleanup appear unsuccessful while the state and diagnostic logs needed for inspection or retry have already vanished. Automation may retry or report an active managed process even though its local record has been destructively removed.
