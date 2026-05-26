# Config mutations prune failed write corrupts prior config document

## Summary

The exported `@poe-code/config-mutations` `configMutation.prune()` operation rewrites a non-empty pruned result directly over the live configuration file. If a replacement write partially modifies an existing valid document before rejecting, the prune operation fails while leaving the persisted configuration malformed.

## Reproduction

Add this disposable in-memory Vitest probe as `packages/config-mutations/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runMutations } from "./execution/run-mutations.js";
import { configMutation } from "./mutations/config-mutation.js";
import type { FileSystem } from "./types.js";

describe("configMutation.prune interrupted update", () => {
  it("rejects after corrupting a prior valid document", async () => {
    const homeDir = "/home/test";
    const targetPath = `${homeDir}/settings.json`;
    const volume = Volume.fromJSON({ [targetPath]: '{"remove":true,"keep":true}\n' });
    const base = createFsFromVolume(volume).promises as unknown as FileSystem;
    const fs: FileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === targetPath) {
          await base.writeFile(filePath, '{"keep":', options);
          throw new Error("prune write interrupted");
        }
        await base.writeFile(filePath, data, options);
      }
    };

    await expect(
      runMutations(
        [configMutation.prune({ target: "~/settings.json", shape: { remove: true } })],
        { fs, homeDir }
      )
    ).rejects.toThrow("prune write interrupted");

    const retained = await base.readFile(targetPath, "utf8");
    console.log(JSON.stringify({ retained }));
    expect(retained).toBe('{"keep":');
  });
});
```

Run the focused probe, then delete the disposable file:

```sh
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm -f packages/config-mutations/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and leaves malformed JSON in the previously valid target after the prune update rejects:

```text
{"retained":"{\"keep\":"}
✓ packages/config-mutations/src/__probe__.test.ts > configMutation.prune interrupted update > rejects after corrupting a prior valid document
```

`configMutation.prune()` is exported at `packages/config-mutations/src/index.ts:1` through `packages/config-mutations/src/index.ts:6` and constructed in `packages/config-mutations/src/mutations/config-mutation.ts:45` through `packages/config-mutations/src/mutations/config-mutation.ts:73`. Its executor parses the current document, computes a non-empty pruned result, serializes it, then calls `context.fs.writeFile(targetPath, serialized, ...)` directly at `packages/config-mutations/src/execution/apply-mutation.ts:454` through `packages/config-mutations/src/execution/apply-mutation.ts:532`. There is no atomic replacement or rollback for a partially completed write.

## Expected Behavior

Pruning managed settings should preserve the last valid configuration whenever the replacement cannot be fully persisted. The operation should stage and atomically replace non-empty rewritten documents, or restore original bytes before propagating a write error.

## Impact

Unconfigure and cleanup operations backed by `configMutation.prune()` can corrupt a user's surviving configuration entries when storage fails during rewrite. Although the deletion call rejects, the remaining configuration may become unparseable, disabling unrelated configured services or forcing manual recovery from lost valid state.
