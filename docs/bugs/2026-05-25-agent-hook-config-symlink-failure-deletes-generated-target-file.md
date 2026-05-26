# Agent Hook Config symlink failure deletes the generated target file

## Summary

The exported `@poe-code/agent-hook-config` `symlinkHooks()` API replaces an existing fully generated hook settings file by first unlinking it and then creating a symbolic link at the same path. If symlink creation fails after deletion succeeds, the operation rejects while the previously active generated hook configuration has already been removed.

## Reproduction

1. Add this disposable probe as `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import * as fs from "node:fs";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const { fs: memoryFs } = await import("memfs");
  return { ...memoryFs, default: memoryFs };
});
vi.mock("./configs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./configs.js")>();
  const base = actual.getAgentConfig("claude-code")!;
  return {
    ...actual,
    getAgentConfig(agentId: string) {
      if (agentId === "source") return { ...base, localHookPath: ".source/settings.json" };
      if (agentId === "target") return { ...base, localHookPath: ".target/settings.json" };
      return actual.getAgentConfig(agentId);
    }
  };
});

import { symlinkHooks } from "./symlink-hooks.js";

describe("symlinkHooks replacement failure probe", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("deletes a generated target hook file before failed symlink creation", () => {
    const targetPath = path.join("/repo", ".target/settings.json");
    vol.fromJSON({
      [targetPath]: JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "old", statusMessage: "[generated:old] old" }
              ]
            }
          ]
        }
      })
    });
    vi.spyOn(fs, "symlinkSync").mockImplementation(() => {
      throw new Error("symlink creation denied");
    });

    expect(() => symlinkHooks("source", "target", "/repo", "/home/test", "project"))
      .toThrow("symlink creation denied");
    expect(() => fs.lstatSync(targetPath)).toThrow();
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/agent-hook-config/src/__probe__.test.ts > symlinkHooks replacement failure probe > deletes a generated target hook file before failed symlink creation
```

## Observed Behavior

The target settings file contains a valid generated hook configuration. `symlinkHooks()` classifies it as replaceable and removes it with `unlinkSync()`. The mocked `symlinkSync()` then rejects with `symlink creation denied`, and the target path no longer exists after the failed operation.

## Expected Behavior

Replacing a generated hook file with a symlink should be atomic or recoverable. If link creation cannot complete, the pre-existing generated hook settings file should remain available or be restored before the failure is returned.

## Impact

A permissions error, filesystem restriction, or transient symlink creation failure can remove an active generated hook configuration while the setup command reports failure. Subsequent agent runs silently lose previously configured hook behavior and require manual restoration or regeneration.
