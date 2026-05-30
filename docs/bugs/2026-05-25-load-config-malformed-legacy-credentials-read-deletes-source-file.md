---
name: "Load Config Malformed Legacy Credentials Read Deletes Source File"
---

# Load Config Malformed Legacy Credentials Read Deletes Source File

## Summary

The public `loadConfig()` read path automatically attempts legacy `credentials.json` migration when no modern config exists. If that legacy credential file contains malformed JSON, merely loading configuration writes a recovery backup, overwrites the legacy file, and then deletes the original credential path before returning `null`.

## Reproduction

Create a disposable Vitest probe at `src/services/__probe__.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import { loadConfig } from "./config.js";
import type { FileSystem } from "../utils/file-system.js";

describe("malformed legacy credentials migration", () => {
  it("deletes malformed legacy credentials during a config read", async () => {
    const home = "/home/user";
    const configPath = resolveConfigPath(home);
    const legacyPath = path.join(path.dirname(configPath), "credentials.json");
    const rawFs = createFsFromVolume(Volume.fromJSON({ [legacyPath]: "{ malformed-secret" }))
      .promises as unknown as FileSystem;

    await expect(loadConfig({ fs: rawFs, filePath: configPath })).resolves.toBeNull();
    await expect(rawFs.readFile(legacyPath, "utf8")).rejects.toThrow();

    const entries = await rawFs.readdir(path.dirname(configPath));
    const invalidBackup = entries.find((entry) => entry.startsWith("credentials.json.invalid-"));
    expect(invalidBackup).toBeDefined();
    await expect(rawFs.readFile(path.join(path.dirname(configPath), invalidBackup!), "utf8"))
      .resolves.toBe("{ malformed-secret");
  });
});
```

Run:

```sh
npm exec -- vitest run src/services/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/services/__probe__.test.ts > malformed legacy credentials migration > deletes malformed legacy credentials during a config read
```

Remove the disposable probe after validation.

## Observed Behavior

`loadConfig()` begins by calling `migrateLegacyConfigIfNeeded()` at `src/services/config.ts:134` through `src/services/config.ts:143`. When modern config is absent, migration loads `credentials.json`; on a `SyntaxError`, `migrateLegacyCredentialsFile()` calls `recoverInvalidConfig()` and then unconditionally invokes `fs.unlink(legacyPath)` at `src/services/config.ts:215` through `src/services/config.ts:245`. `recoverInvalidConfig()` already writes the malformed contents to a timestamped backup and replaces the source with an empty document at `src/services/config.ts:297` through `src/services/config.ts:311`. In the probe, a read-only `loadConfig()` call returns `null`, removes `credentials.json`, and leaves only a generated invalid backup containing the original bytes.

## Expected Behavior

Reading configuration should not destructively remove a malformed legacy credential source. Invalid legacy data should be reported or preserved for explicit migration/recovery, and any automatic repair should not delete the source credential path as an unannounced side effect of a read.

## Impact

An ordinary startup or credential lookup can erase a malformed-but-forensically-important legacy credential file before a user inspects or repairs it. Although a backup is attempted, the active path disappears silently during a read and the backup mechanism itself is subject to persistence and naming failures, making credential recovery less reliable and read behavior unexpectedly destructive.
