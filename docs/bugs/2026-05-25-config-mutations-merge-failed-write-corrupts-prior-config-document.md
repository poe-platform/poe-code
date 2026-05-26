# Config Mutations Merge Failed Write Corrupts Prior Config Document

## Summary

The exported `@poe-code/config-mutations` `configMutation.merge()` executor serializes updated configuration and writes directly over the live target file. If an update partially changes the target before its write rejects, the operation reports failure but destroys the prior valid configuration document.

## Reproduction

Create a disposable Vitest probe at `packages/config-mutations/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runMutations } from "./execution/run-mutations.js";
import { configMutation } from "./mutations/config-mutation.js";
import type { FileSystem } from "./types.js";

describe("config merge interrupted overwrite", () => {
  it("destroys prior valid JSON configuration when update write rejects", async () => {
    const targetPath = "/home/user/.config/settings.json";
    const base = createFsFromVolume(Volume.fromJSON({
      [targetPath]: JSON.stringify({ existing: true }),
    })).promises as unknown as FileSystem;
    const fs: FileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === targetPath) {
          await base.writeFile(filePath, "{", options);
          throw new Error("config disk full");
        }
        await base.writeFile(filePath, data, options);
      },
    };

    await expect(runMutations(
      [configMutation.merge({ target: "~/.config/settings.json", value: { added: true } })],
      { fs, homeDir: "/home/user" },
    )).rejects.toThrow("config disk full");
    const raw = await base.readFile(targetPath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("{");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"{"}
✓ packages/config-mutations/src/__probe__.test.ts > config merge interrupted overwrite > destroys prior valid JSON configuration when update write rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`applyConfigMerge()` reads and parses the existing target at `packages/config-mutations/src/execution/apply-mutation.ts:415`, computes replacement serialized content, and then directly overwrites the target through `context.fs.writeFile()` at `packages/config-mutations/src/execution/apply-mutation.ts:441`. In the probe, the exported mutation rejects with `"config disk full"` after the previously valid JSON target has been replaced by malformed content `"{"`.

## Expected Behavior

Configuration mutation updates should preserve the existing valid document when a new write cannot be completed. The executor should use atomic replacement or rollback semantics for merge, prune, transform, and template-backed update paths that replace live configuration content.

## Impact

Any provider or feature using the shared mutation executor can lose an existing user configuration document during a transient filesystem failure while attempting a single update. The originating operation reports failure, but later tooling sees malformed or unrecoverable configuration rather than the prior valid settings.
