# Poe Code Config Write Scope Failed Write Corrupts Prior Config Document

## Summary

The exported `@poe-code/poe-code-config` `writeScope()` API writes an updated scope directly over the active JSON configuration file. If persistence partially modifies that file before rejecting, the operation fails while destroying the previously valid configuration document.

## Reproduction

Create a disposable Vitest probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "@poe-code/config-mutations";
import { writeScope } from "./store.js";

describe("poe-code config scope interrupted overwrite", () => {
  it("destroys the prior valid config document when scope persistence rejects", async () => {
    const filePath = "/home/user/.poe-code/config.json";
    const base = createFsFromVolume(Volume.fromJSON({
      [filePath]: JSON.stringify({ core: { apiKey: "old" } }),
    })).promises as unknown as FileSystem;
    const fs: FileSystem = {
      ...base,
      async writeFile(targetPath, data, options) {
        if (targetPath === filePath) {
          await base.writeFile(targetPath, "{", options);
          throw new Error("config scope disk full");
        }
        await base.writeFile(targetPath, data, options);
      },
    };

    await expect(writeScope(fs, filePath, "ui", { darkMode: true })).rejects.toThrow("config scope disk full");
    const raw = await base.readFile(filePath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("{");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"{"}
✓ packages/poe-code-config/src/__probe__.test.ts > poe-code config scope interrupted overwrite > destroys the prior valid config document when scope persistence rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`writeScope()` loads and updates the current document at `packages/poe-code-config/src/store.ts:11`, then delegates persistence to `writeDocument()` at `packages/poe-code-config/src/store.ts:26`. `writeDocument()` overwrites the live target through `fs.writeFile()` at `packages/poe-code-config/src/store.ts:155`. In the probe, `writeScope()` rejects with `"config scope disk full"`, but the former valid configuration has already been replaced with malformed content `"{"`.

## Expected Behavior

Updating one configuration scope should preserve the last valid document if the replacement cannot be committed completely. `writeScope()` should persist using atomic replacement or equivalent rollback semantics instead of exposing partial writes in the active configuration path.

## Impact

Callers of the public scope-writing API can lose a working `.poe-code/config.json` file during a transient filesystem or storage failure. The failed operation surfaces an error, but later configuration reads encounter malformed content and must recover from corruption rather than continuing with the prior valid settings.
