# Config Mutations symlinked config target writes outside home

## Summary

The public `@poe-code/config-mutations` API requires configuration targets to be home-relative, but it never verifies the canonical destination before reading or writing the resolved path. A valid target such as `~/.config.json` that is a symlink to an external file causes `configMutation.merge()` to read and overwrite that external file while reporting a successful home-scoped config update.

## Reproduction

From the repository root, create and run this disposable in-memory Vitest probe:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'EOF'
import { vol, fs as memoryFs } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { configMutation, runMutations } from "./index.js";
import type { FileSystem } from "./types.js";

describe("home-relative config target symlink containment", () => {
  afterEach(() => {
    vol.reset();
  });

  it("writes merged config through a home target symlink into an external file", async () => {
    const targetPath = "/home/test/.config.json";
    const outsidePath = "/outside/controlled.json";
    vol.fromJSON({ [outsidePath]: '{"outside":true}\n' }, "/");
    vol.mkdirSync("/home/test", { recursive: true });
    vol.symlinkSync(outsidePath, targetPath);
    const fs = memoryFs.promises as unknown as FileSystem;

    const result = await runMutations(
      [configMutation.merge({ target: "~/.config.json", value: { managed: true }, format: "json" })],
      { fs, homeDir: "/home/test" }
    );

    const outside = vol.readFileSync(outsidePath, "utf8") as string;
    console.log(JSON.stringify({ result, outside, targetIsSymlink: vol.lstatSync(targetPath).isSymbolicLink() }));
    expect(outside).toContain('"managed": true');
    expect(vol.lstatSync(targetPath).isSymbolicLink()).toBe(true);
  });
});
EOF
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"result":{"changed":true,"effects":[{"changed":true,"effect":"write","detail":"update"}]},"outside":"{\n  \"outside\": true,\n  \"managed\": true\n}\n","targetIsSymlink":true}
```

## Observed Behavior

`configMutation.merge()` accepts the home-relative `~/.config.json` target, follows its symbolic link to `/outside/controlled.json`, incorporates the external file's pre-existing JSON into the merged content, and writes the updated document back through the symlink. The returned mutation result classifies this as an ordinary successful update.

`resolvePath()` checks only the lexical `~` prefix and expands it into the supplied home directory at `packages/config-mutations/src/execution/path-utils.ts:34` through `packages/config-mutations/src/execution/path-utils.ts:77`; it does not inspect symlinks or enforce canonical containment. `applyConfigMerge()` then reads and writes that resolved target directly at `packages/config-mutations/src/execution/apply-mutation.ts:393` through `packages/config-mutations/src/execution/apply-mutation.ts:451`, so the symlink destination outside home receives the mutation.

## Expected Behavior

Home-scoped mutation operations should remain within the canonical configured home directory. A target path that resolves through a symbolic link outside that boundary should be rejected before reading or modifying the external destination.

## Impact

A manipulated home configuration layout, installer artifact, or local attacker able to place a symlink can turn routine provider or agent configuration operations into external file modifications. The mutation API may read unrelated external JSON as existing configuration and overwrite it with managed state while claiming to have safely updated a home-relative config file.
