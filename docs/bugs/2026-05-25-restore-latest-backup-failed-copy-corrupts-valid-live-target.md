# `restoreLatestBackup()` can corrupt a valid live target when replacement fails

## Summary

The exported `restoreLatestBackup()` utility restores the latest backup by copying it directly over the live target. For supported filesystem implementations that expose `readFile()` and `writeFile()` but not `copyFile()`, a failed target write can reject after partially overwriting the previously valid live document.

## Reproduction

From the repository root, add a disposable probe at `src/utils/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import type { FileSystem } from "./file-system.js";
import { restoreLatestBackup } from "./backup.js";

describe("restoreLatestBackup failed replacement repro", () => {
  it("rejects after overwriting part of the previously live target", async () => {
    const targetPath = "/home/user/config.toml";
    const baseFs = createMockFs(
      {
        [targetPath]: "current valid content",
        [`${targetPath}.backup.2026-05-25T01-00-00`]: "restored backup content"
      },
      "/home/user"
    );
    const fs: FileSystem = {
      ...baseFs,
      copyFile: undefined,
      writeFile: async (path, data, options) => {
        if (path === targetPath) {
          await baseFs.writeFile(path, "partial restored bytes", options);
          throw new Error("replacement write failed");
        }
        await baseFs.writeFile(path, data, options);
      }
    };

    await expect(restoreLatestBackup(fs, targetPath)).rejects.toThrow("replacement write failed");
    await expect(baseFs.readFile(targetPath, "utf8")).resolves.toBe("partial restored bytes");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run src/utils/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/utils/__probe__.test.ts > restoreLatestBackup failed replacement repro > rejects after overwriting part of the previously live target
```

Remove the disposable probe after validation.

## Observed Behavior

With `config.toml` initially containing `current valid content` and a valid backup sibling available, `restoreLatestBackup()` rejects with `replacement write failed`, but reading the target afterward returns `partial restored bytes`. The helper's fallback copy path reads the selected backup and writes its bytes directly to the target without a temporary-file commit boundary or rollback.

## Expected Behavior

A failed restore should leave the previously valid target intact, or the operation should atomically publish the restored document only after the full replacement has been written successfully.

## Impact

Recovery intended to restore a prior working configuration can instead destroy the active valid file during an I/O failure, leaving neither the original content nor a completed restore at the expected path. Callers receive an error but still incur destructive configuration loss and may require manual recovery from backup files.
