# Poe Agent Files Plugin Create Race Overwrites Concurrently Created File

## Summary

The Poe Agent `edit_file` tool documents `create` as writing a new file and failing if it already exists, but implements that contract with a separate existence check followed by an ordinary write. A file created after the check is silently overwritten while the tool reports successful creation.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/plugins/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import filesPlugin from "./poe-agent-plugin-files.js";

describe("poe agent file create race", () => {
  it("overwrites a file created after the existence check", async () => {
    const filePath = "/workspace/project/src/new.ts";
    const base = createFsFromVolume(Volume.fromJSON({})).promises;
    let checked = false;
    const fs = {
      ...base,
      async stat(targetPath: string) {
        if (targetPath === filePath && !checked) {
          checked = true;
          const missing = new Error("missing") as NodeJS.ErrnoException;
          missing.code = "ENOENT";
          throw missing;
        }
        return await base.stat(targetPath);
      },
      async mkdir(targetPath: string, options?: unknown) {
        await base.mkdir(targetPath, options as never);
        if (checked) {
          await base.writeFile(filePath, "created by another actor\n", "utf8");
        }
      }
    };
    const plugin = filesPlugin({ cwd: "/workspace/project", fs: fs as never });
    const edit = plugin.tools?.find((tool) => tool.name === "edit_file");

    await expect(edit!.call({
      command: "create",
      path: "src/new.ts",
      file_text: "created by agent\n"
    }, { signal: new AbortController().signal } as never)).resolves.toBe("Created file: src/new.ts");
    const raw = await base.readFile(filePath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("created by agent\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/plugins/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"created by agent\n"}
✓ packages/poe-agent/src/plugins/__probe__.test.ts > poe agent file create race > overwrites a file created after the existence check
```

Remove the disposable probe after validation.

## Observed Behavior

The tool describes `create` as failing when the target exists at `packages/poe-agent/src/plugins/poe-agent-plugin-files.ts:119` through `packages/poe-agent/src/plugins/poe-agent-plugin-files.ts:123`. Its implementation first calls `fileExists()` and throws only if that observation is already true, then creates parent directories and executes an unconditional `fs.writeFile()` at `packages/poe-agent/src/plugins/poe-agent-plugin-files.ts:192` through `packages/poe-agent/src/plugins/poe-agent-plugin-files.ts:201`. In the probe, another actor writes `created by another actor` after the check but before the final write; `edit_file` resolves as `Created file: src/new.ts` and the concurrently created content is replaced with the agent's text.

## Expected Behavior

The `create` command should atomically fail if a target file exists at commit time. It should use exclusive-create semantics rather than a check-then-overwrite sequence that violates its advertised non-destructive behavior under concurrency.

## Impact

Agents operating alongside user edits, file watchers, generators, or parallel agents can silently destroy newly created source or configuration files while receiving a success message that implies no prior content existed. This creates lost updates and makes concurrent workspace operation unsafe even when callers intentionally select the non-overwriting `create` command.
