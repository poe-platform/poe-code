# Config mutations template write failed update corrupts prior output

## Summary

The exported `@poe-code/config-mutations` `templateMutation.write()` operation replaces an existing rendered file by writing directly to its live path. If the filesystem partially overwrites that file and then rejects, `runMutations()` reports failure after the previous valid template output has already been corrupted.

## Reproduction

Add this disposable in-memory Vitest probe as `packages/config-mutations/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runMutations } from "./execution/run-mutations.js";
import { templateMutation } from "./mutations/template-mutation.js";
import type { FileSystem } from "./types.js";

describe("templateMutation.write interrupted update", () => {
  it("rejects after corrupting prior template output", async () => {
    const homeDir = "/home/test";
    const targetPath = `${homeDir}/config/instructions.md`;
    const volume = Volume.fromJSON({ [targetPath]: "# prior complete document\n" });
    const base = createFsFromVolume(volume).promises as unknown as FileSystem;
    const fs: FileSystem = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === targetPath) {
          await base.writeFile(filePath, "# truncated", options);
          throw new Error("disk full during template write");
        }
        await base.writeFile(filePath, data, options);
      }
    };

    await expect(
      runMutations(
        [templateMutation.write({ target: "~/config/instructions.md", templateId: "instructions" })],
        { fs, homeDir, templates: async () => "# refreshed complete document\n" }
      )
    ).rejects.toThrow("disk full during template write");

    const retained = await base.readFile(targetPath, "utf8");
    console.log(JSON.stringify({ retained }));
    expect(retained).toBe("# truncated");
  });
});
```

Run the focused probe, then delete the disposable file:

```sh
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm -f packages/config-mutations/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and prints the corrupted retained contents after the operation rejects:

```text
{"retained":"# truncated"}
✓ packages/config-mutations/src/__probe__.test.ts > templateMutation.write interrupted update > rejects after corrupting prior template output
```

`templateMutation.write()` is exported as a public mutation constructor at `packages/config-mutations/src/index.ts:1` through `packages/config-mutations/src/index.ts:6` and `packages/config-mutations/src/mutations/template-mutation.ts:42` through `packages/config-mutations/src/mutations/template-mutation.ts:75`. Its executor detects whether the target already exists, then invokes `context.fs.writeFile(targetPath, rendered, ...)` directly on the live destination at `packages/config-mutations/src/execution/apply-mutation.ts:613` through `packages/config-mutations/src/execution/apply-mutation.ts:653`. No staging file, atomic rename, or restoration path preserves the previous valid document when that replacement write fails after modifying the file.

## Expected Behavior

Replacing an existing template output should preserve the previously valid file if persistence cannot complete. The mutation should stage and atomically commit replacement contents, or otherwise restore prior content before rejecting a failed update.

## Impact

Consumers using template mutations for generated instructions, skill documents, scripts, or configuration fragments can lose a previously working output during a disk-full event, interrupted filesystem write, or storage failure. The caller receives an error, but subsequent tooling reads a truncated or invalid persisted document instead of the last successful version.
