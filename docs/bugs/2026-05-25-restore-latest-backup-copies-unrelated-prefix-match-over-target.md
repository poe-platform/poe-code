# Restore latest backup copies unrelated prefix match over target

## Summary

The exported `restoreLatestBackup()` utility considers every sibling filename beginning with `<target>.backup.` to be a valid backup, then restores the lexicographically greatest match. An unrelated file with that prefix can therefore supersede genuine generated backups and be copied over the target document.

## Reproduction

From the repository root, add this disposable Vitest probe at `src/utils/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { restoreLatestBackup } from "./backup.js";
import type { FileSystem } from "./file-system.js";

describe("backup prefix collision", () => {
  it("restores an unrelated suffix file as the latest backup", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({
      "/home/user/config.toml": "current",
      "/home/user/config.toml.backup.2026-01-01": "valid backup",
      "/home/user/config.toml.backup.zzz-not-a-backup": "unrelated content",
    })).promises as unknown as FileSystem;

    const restored = await restoreLatestBackup(fs, "/home/user/config.toml");
    const content = await fs.readFile("/home/user/config.toml", "utf8");
    console.log(JSON.stringify({ restored, content }));

    expect(restored).toBe(true);
    expect(content).toBe("unrelated content");
  });
});
```

Run:

```sh
npm exec -- vitest run src/utils/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"restored":true,"content":"unrelated content"}
✓ src/utils/__probe__.test.ts > backup prefix collision > restores an unrelated suffix file as the latest backup
```

## Observed Behavior

`createBackup()` writes files using the format `${targetPath}.backup.${timestamp()}` at `src/utils/backup.ts:10`, but `restoreLatestBackup()` does not validate that suffix as a generated timestamp. It simply filters sibling entries by `startsWith(`${base}.backup.`)`, sorts all matching names, reverses them, and copies the first entry over the target at `src/utils/backup.ts:24`. In the probe, `config.toml.backup.zzz-not-a-backup` sorts after the genuine timestamped backup and overwrites `config.toml` during restore.

## Expected Behavior

Backup restoration should consider only backups created by the utility's naming convention, or otherwise use recorded backup metadata. Unrelated sibling files that merely begin with the backup prefix must not be selected as restore sources.

## Impact

Any user, tool, or partially corrupted configuration directory able to create a prefixed sibling file can cause restoration to overwrite a target configuration with unrelated content. Recovery workflows may silently replace valid settings or credentials with arbitrary local data while reporting that the latest backup was successfully restored.
