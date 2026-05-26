# Poe Agent Files Plugin Failed Str Replace Corrupts Prior Workspace File

## Summary

The Poe Agent `edit_file` tool applies `str_replace` edits by directly overwriting the active workspace file. If the replacement partially modifies that file before rejecting, an agent-visible edit failure destroys the previously valid source contents.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/plugins/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import filesPlugin from "./poe-agent-plugin-files.js";

describe("poe agent interrupted file edit", () => {
  it("destroys prior workspace content when str_replace persistence rejects", async () => {
    const filePath = "/workspace/project/src/app.ts";
    const base = createFsFromVolume(Volume.fromJSON({
      [filePath]: "export const value = 'old';\n"
    })).promises;
    const fs = {
      ...base,
      async writeFile(targetPath: string, data: string | Uint8Array, options?: unknown) {
        if (targetPath === filePath) {
          await base.writeFile(targetPath, "export const", options as never);
          throw new Error("workspace disk full");
        }
        await base.writeFile(targetPath, data, options as never);
      }
    };
    const plugin = filesPlugin({ cwd: "/workspace/project", fs: fs as never });
    const edit = plugin.tools?.find((tool) => tool.name === "edit_file");

    await expect(edit!.call({
      command: "str_replace",
      path: "src/app.ts",
      old_str: "'old'",
      new_str: "'new'"
    }, { signal: new AbortController().signal } as never)).rejects.toThrow("workspace disk full");
    const raw = await base.readFile(filePath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("export const");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/plugins/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"export const"}
✓ packages/poe-agent/src/plugins/__probe__.test.ts > poe agent interrupted file edit > destroys prior workspace content when str_replace persistence rejects
```

Remove the disposable probe after validation.

## Observed Behavior

For `str_replace`, the files plugin reads the live target, validates the requested replacement, and directly persists the replacement through `fs.writeFile()` at `packages/poe-agent/src/plugins/poe-agent-plugin-files.ts:159` through `packages/poe-agent/src/plugins/poe-agent-plugin-files.ts:189`. In the probe, the initial TypeScript file contains `export const value = 'old';`; the tool rejects with `"workspace disk full"` after replacing it with truncated content `"export const"`.

## Expected Behavior

An agent file edit reported as failed should preserve the prior valid workspace file when the replacement cannot complete. Surgical edit operations should use atomic replacement or rollback semantics instead of leaving partially written source code at the original path.

## Impact

A transient filesystem failure during an ordinary agent edit can destroy user code while the tool reports no successful modification. Subsequent agent steps, tests, builds, or user recovery encounter corrupted source rather than the original file, making failed edits destructive and difficult to safely retry.
