# Ralph unknown hook scope key drops requested source scope

## Summary

The exported `@poe-code/ralph` document schema forbids unknown properties within hook configurations, but `parseFrontmatterData()` ignores them. A plan that misspells `hooks.scope: user` as `hooks.scoep: user` is accepted and invokes its agent without the requested scope, changing the possible hook source selection.

## Reproduction

Create the following disposable probe at `packages/ralph/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runRalph } from "./run/ralph.js";

it("ignores a misspelled hook scope and forwards no requested scope", async () => {
  const rawFs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/.poe-code/ralph/plans/plan.md": [
          "---",
          "kind: ralph",
          "version: 1",
          "agent: codex",
          "iterations: 1",
          "hooks:",
          "  from: hook-pack",
          "  scoep: user",
          "status:",
          "  state: open",
          "  iteration: 0",
          "---",
          "# Improve it",
          ""
        ].join("\n")
      },
      "/"
    )
  ).promises;
  const fs = {
    readFile: (filePath: string, encoding: BufferEncoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
    writeFile: (filePath: string, content: string) => rawFs.writeFile(filePath, content, "utf8") as Promise<void>,
    readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
    open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
    stat: async (filePath: string) => { const stat = await rawFs.stat(filePath); return { isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory(), mtimeMs: Number(stat.mtimeMs) }; },
    unlink: (filePath: string) => rawFs.unlink(filePath) as Promise<void>,
    mkdir: (filePath: string, options?: { recursive?: boolean }) => rawFs.mkdir(filePath, options) as Promise<void>,
    rmdir: (filePath: string) => rawFs.rmdir(filePath) as Promise<void>,
    rename: (oldPath: string, newPath: string) => rawFs.rename(oldPath, newPath) as Promise<void>
  };
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  await runRalph({ cwd: "/repo", homeDir: "/home/test", docPath: ".poe-code/ralph/plans/plan.md", fs, runAgent });

  expect(runAgent.mock.calls[0]?.[0].hooks).toEqual({ from: "hook-pack" });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
rm packages/ralph/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/ralph/src/__probe__.test.ts > ignores a misspelled hook scope and forwards no requested scope
```

## Observed Behavior

`packages/ralph/src/frontmatter/frontmatter.ts` publishes hook objects with `additionalProperties: false` and supports a `scope` value of `project`, `user`, or `merged`. Its `parseHooks()` function does not reject unknown `scoep`; it retains only `{ from: "hook-pack" }`. `runRalph()` forwards that reduced hook definition to the autonomous agent, omitting the document's apparent user-only source selection.

## Expected Behavior

`parseFrontmatterData()` should reject unknown hook keys such as `scoep` before invoking any agent without the requested hook source scope.

## Impact

A small typo can change the source set of hooks made available during Ralph execution. The agent may use project or merged hook content when the author intended user-only instructions, leading to unexpected behavior or edits while the plan is accepted as runnable.
