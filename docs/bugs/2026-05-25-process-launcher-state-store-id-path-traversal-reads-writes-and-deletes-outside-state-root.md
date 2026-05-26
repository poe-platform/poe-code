# Process launcher state store ID path traversal reads, writes, and deletes outside state root

## Summary

The exported `createStateStore()` API in `@poe-code/process-launcher` accepts arbitrary process IDs and interpolates them directly into filesystem paths. An ID such as `../outside` escapes the configured state directory for `write()`, `read()`, and `remove()`, allowing state operations to modify and recursively delete files outside the managed-process root.

## Reproduction

1. From the repository root, create this disposable Vitest probe using `memfs`:

   ```sh
   cat > packages/process-launcher/src/state/__probe__.test.ts <<'EOF'
   import path from "node:path";
   import { Volume, createFsFromVolume } from "memfs";
   import { describe, expect, it } from "vitest";
   import type { LauncherFileSystem, ProcessState } from "../types.js";
   import { createStateStore } from "./state-store.js";

   function createState(id: string): ProcessState {
     return {
       id,
       pid: null,
       status: "stopped",
       runtime: "host",
       restartCount: 0,
       lastExitCode: 0,
       lastStartedAt: null,
       lastStoppedAt: null,
       command: "echo",
       args: []
     };
   }

   describe("process state id traversal", () => {
     it("writes, reads, and removes a state file outside the configured state root", async () => {
       const fs = createFsFromVolume(new Volume()).promises as unknown as LauncherFileSystem;
       const store = createStateStore("/state", fs);
       const entry = createState("../outside");

       await store.write(entry.id, entry);
       await expect(fs.readFile(path.join("/outside", "state.json"), "utf8")).resolves.toContain('"id": "../outside"');
       await expect(store.read("../outside")).resolves.toEqual(entry);

       await store.remove("../outside");
       await expect(fs.readFile(path.join("/outside", "state.json"), "utf8")).rejects.toThrow();
     });
   });
   EOF
   ```

2. Run the probe and remove it afterward:

   ```sh
   npm exec -- vitest run packages/process-launcher/src/state/__probe__.test.ts --reporter verbose
   rm -f packages/process-launcher/src/state/__probe__.test.ts
   ```

3. The disposable probe passes:

   ```text
   ✓ packages/process-launcher/src/state/__probe__.test.ts > process state id traversal > writes, reads, and removes a state file outside the configured state root

   Test Files  1 passed (1)
        Tests  1 passed (1)
   ```

## Observed Behavior

For `createStateStore("/state")`, writing an entry whose `id` is `../outside` creates `/outside/state.json`; reading the same ID loads that external state; and removing it deletes the escaped directory content. `createStateStore()` is publicly exported at `packages/process-launcher/src/index.ts:14`. Its path construction at `packages/process-launcher/src/state/state-store.ts:50` through `packages/process-launcher/src/state/state-store.ts:69` and `packages/process-launcher/src/state/state-store.ts:113` through `packages/process-launcher/src/state/state-store.ts:115` joins caller IDs without validating that they are safe path segments.

## Expected Behavior

Managed process IDs should be validated before use as directory names, rejecting absolute paths, separators, traversal components, and other unsafe identifiers. All state-store reads, writes, and removals must remain beneath the configured `stateDir`.

## Impact

Callers that pass user-controlled or document-controlled process IDs can overwrite state outside the launch directory, read external JSON as process state, or recursively delete unrelated files through `remove()`. This breaks state-root isolation and turns managed-process operations into a filesystem traversal primitive.
