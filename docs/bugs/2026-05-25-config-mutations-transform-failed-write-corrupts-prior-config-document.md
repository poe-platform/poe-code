# Config mutations transform failed write corrupts prior config document

## Summary

The exported `@poe-code/config-mutations` `configMutation.transform()` operation serializes transformed state and writes it directly over the live target file. If that replacement partially modifies a previously valid document and then rejects, the transform request reports failure while the persisted configuration is left corrupted.

## Reproduction

Add this disposable in-memory Vitest probe as `packages/config-mutations/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runMutations } from "./execution/run-mutations.js";
import { configMutation } from "./mutations/config-mutation.js";
import type { FileSystem } from "./types.js";

describe("configMutation.transform interrupted update", () => {
  it("rejects after corrupting a prior valid document", async () => {
    const homeDir = "/home/test";
    const targetPath = `${homeDir}/settings.json`;
    const volume = Volume.fromJSON({ [targetPath]: '{"keep":true}\n' });
    const base = createFsFromVolume(volume).promises as unknown as FileSystem;
    const fs: FileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === targetPath) {
          await base.writeFile(filePath, '{"corrupt":', options);
          throw new Error("transform write interrupted");
        }
        await base.writeFile(filePath, data, options);
      }
    };

    await expect(
      runMutations(
        [configMutation.transform({ target: "~/settings.json", transform: () => ({ content: { keep: true, added: true }, changed: true }) })],
        { fs, homeDir }
      )
    ).rejects.toThrow("transform write interrupted");

    const retained = await base.readFile(targetPath, "utf8");
    console.log(JSON.stringify({ retained }));
    expect(retained).toBe('{"corrupt":');
  });
});
```

Run the focused probe, then delete the disposable file:

```sh
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm -f packages/config-mutations/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and records a malformed retained document after the update rejects:

```text
{"retained":"{\"corrupt\":"}
✓ packages/config-mutations/src/__probe__.test.ts > configMutation.transform interrupted update > rejects after corrupting a prior valid document
```

`configMutation.transform()` is publicly exposed through `packages/config-mutations/src/index.ts:1` through `packages/config-mutations/src/index.ts:6` and `packages/config-mutations/src/mutations/config-mutation.ts:58` through `packages/config-mutations/src/mutations/config-mutation.ts:73`. The transform executor reads and parses the current document, accepts caller-supplied transformed state, serializes it, and invokes `context.fs.writeFile(targetPath, serialized, ...)` directly on the live path at `packages/config-mutations/src/execution/apply-mutation.ts:530` through `packages/config-mutations/src/execution/apply-mutation.ts:606`. Unlike an atomic replacement, this path leaves the old valid document destroyed when the write fails after modifying the destination.

## Expected Behavior

A failed transform update should leave the last valid target document readable and unchanged. Replacement content should be staged and atomically committed, or prior content should be restored before a persistence failure is surfaced.

## Impact

Providers and configuration workflows using transform mutations to add, remove, or rewrite managed settings can lose all valid persisted configuration due to a single interrupted update. A caller observes a failed command or SDK call, but subsequent configuration reads encounter truncated or invalid data instead of the previous working state.
