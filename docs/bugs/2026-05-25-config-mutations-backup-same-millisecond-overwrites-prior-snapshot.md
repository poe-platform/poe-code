# Config Mutations Backup Same Millisecond Overwrites Prior Snapshot

## Summary

The exported `@poe-code/config-mutations` `fileMutation.backup()` operation names backup files only from the target path and a millisecond-resolution timestamp. Two successful backups of the same target performed within one millisecond write to the same destination path, so the later backup silently overwrites the earlier snapshot.

## Reproduction

Create a disposable Vitest probe at `packages/config-mutations/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMutations } from "./execution/run-mutations.js";
import { fileMutation } from "./mutations/file-mutation.js";
import { createMockFs } from "./testing/mock-fs.js";

describe("config mutation backup timestamp collision", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("overwrites an earlier backup created in the same millisecond", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:34:56.789Z"));

    const fs = createMockFs({ "~/.config/settings.json": '{"token":"first"}' });
    const context = { fs, homeDir: "/home/test" };

    await runMutations(
      [fileMutation.backup({ target: "~/.config/settings.json" })],
      context
    );
    await fs.writeFile("/home/test/.config/settings.json", '{"token":"second"}', {
      encoding: "utf8"
    });
    await runMutations(
      [fileMutation.backup({ target: "~/.config/settings.json" })],
      context
    );

    const backupPath =
      "/home/test/.config/settings.json.backup-2026-05-25T12-34-56-789Z";
    const backups = Object.keys(fs.files).filter((filePath) => filePath.includes(".backup-"));

    expect(backups).toEqual([backupPath]);
    expect(fs.getContent(backupPath)).toBe('{"token":"second"}');
  });
});
```

Run:

```sh
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/config-mutations/src/__probe__.test.ts > config mutation backup timestamp collision > overwrites an earlier backup created in the same millisecond
```

Remove the disposable probe after validation.

## Observed Behavior

`fileMutation.backup()` is exposed by the package public API through `packages/config-mutations/src/index.ts:3`. `applyBackup()` creates the destination name as ``${targetPath}.backup-${createTimestamp()}`` and writes it directly at `packages/config-mutations/src/execution/apply-mutation.ts:356` through `packages/config-mutations/src/execution/apply-mutation.ts:386`. `createTimestamp()` contains only ISO timestamp data at millisecond precision at `packages/config-mutations/src/fs-utils.ts:50` through `packages/config-mutations/src/fs-utils.ts:56`. In the probe, two successful backups of different live contents produce one backup path, containing only the second value.

## Expected Behavior

Every successful backup invocation should retain its own snapshot, even when multiple backups of the same file occur during the same clock millisecond. Backup destination naming should be collision-safe or writes should refuse to overwrite an existing generated snapshot.

## Impact

Fast repeated configuration operations, concurrent callers, or fixed/frozen clocks in automation can silently erase the only snapshot holding an earlier user configuration state. Both backup operations report success while recovery history is lost, undermining the purpose of creating backups before mutations.
