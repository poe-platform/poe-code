# Toolcraft OpenAPI Lock Failed Write Corrupts Prior Spec Pin

## Summary

The exported `writeOpenApiLock()` helper rewrites `openapi.lock` directly when updating a specification SHA. If the replacement write fails after committing a prefix, the helper reports the error but destroys the previous valid lock document, leaving the project unable to read its prior spec pin.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { expect, it } from "vitest";

import { readOpenApiLock, writeOpenApiLock, type LockFileSystem } from "./lock.js";

it("corrupts the previous lock document when an update write fails", async () => {
  const backing = createFsFromVolume(
    Volume.fromJSON({ "/repo/openapi.lock": '{\n  "version": 1,\n  "specSha": "old-sha"\n}\n' }, "/")
  ).promises;
  const fs: LockFileSystem = {
    mkdir: async (directoryPath, options) => backing.mkdir(directoryPath, options),
    readFile: (filePath, encoding) => backing.readFile(filePath, encoding) as Promise<string>,
    async writeFile(filePath, contents, encoding) {
      await backing.writeFile(filePath, contents.slice(0, 1), encoding);
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    }
  };

  await expect(writeOpenApiLock(fs, "/repo/openapi.lock", { specSha: "new-sha" })).rejects.toThrow(
    'Failed to write lock file "/repo/openapi.lock" (ENOSPC): disk full'
  );
  await expect(readOpenApiLock(fs, "/repo/openapi.lock")).rejects.toThrow("is not valid JSON");
  await expect(backing.readFile("/repo/openapi.lock", "utf8")).resolves.toBe("{");
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/toolcraft-openapi/src/__probe__.test.ts > corrupts the previous lock document when an update write fails
```

Remove the disposable probe after validation.

## Observed Behavior

`readOpenApiLock()` parses the current JSON lock document and throws a user-facing error for malformed JSON at `packages/toolcraft-openapi/src/lock.ts:19` through `packages/toolcraft-openapi/src/lock.ts:65`. `writeOpenApiLock()` ensures the directory exists and then directly writes the replacement serialized lock to the live path at `packages/toolcraft-openapi/src/lock.ts:67` through `packages/toolcraft-openapi/src/lock.ts:84`. In the probe, an existing valid `old-sha` lock is reduced to `{` by a partial failed update for `new-sha`; the write rejects with `ENOSPC`, and reading the lock afterward fails as invalid JSON.

## Expected Behavior

Updating a specification lock should atomically commit the new pin or leave the previous valid SHA document intact when persistence fails. A failed lock refresh must not invalidate the existing reproducibility record.

## Impact

Transient filesystem failures during OpenAPI generation or lock updates can destroy the only saved spec digest while reporting an unsuccessful write. Follow-up generation, verification, or CI operations encounter a corrupt lock instead of the previously known specification pin, forcing manual recovery and undermining reproducible client generation.
