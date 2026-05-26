# Ralph unknown iterations key expands run budget

## Summary

The exported `@poe-code/ralph` document schema forbids unknown frontmatter properties, but `parseFrontmatterData()` ignores them. A plan that misspells `iterations: 1` as `iteratons: 1` is accepted and silently receives Ralph's default of three iterations, tripling the intended autonomous agent work.

## Reproduction

Create the following disposable probe at `packages/ralph/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runRalph } from "./run/ralph.js";

it("ignores a misspelled iterations limit and runs the default three times", async () => {
  const rawFs = createFsFromVolume(
    Volume.fromJSON(
      {
        "/repo/.poe-code/ralph/plans/plan.md": [
          "---",
          "kind: ralph",
          "version: 1",
          "agent: codex",
          "iteratons: 1",
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
    stat: async (filePath: string) => {
      const stat = await rawFs.stat(filePath);
      return { isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory(), mtimeMs: Number(stat.mtimeMs) };
    },
    unlink: (filePath: string) => rawFs.unlink(filePath) as Promise<void>,
    mkdir: (filePath: string, options?: { recursive?: boolean }) => rawFs.mkdir(filePath, options) as Promise<void>,
    rmdir: (filePath: string) => rawFs.rmdir(filePath) as Promise<void>,
    rename: (oldPath: string, newPath: string) => rawFs.rename(oldPath, newPath) as Promise<void>
  };
  const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

  const result = await runRalph({ cwd: "/repo", homeDir: "/home/test", docPath: ".poe-code/ralph/plans/plan.md", fs, runAgent });

  expect(result.iterationsCompleted).toBe(3);
  expect(runAgent).toHaveBeenCalledTimes(3);
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
rm packages/ralph/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/ralph/src/__probe__.test.ts > ignores a misspelled iterations limit and runs the default three times
```

## Observed Behavior

`packages/ralph/src/frontmatter/frontmatter.ts` publishes `ralphDocumentSchema` with `additionalProperties: false` and an `iterations` field constrained to positive integers, but `parseFrontmatterData()` never rejects unknown fields. The misspelled `iteratons` field is discarded. With no parsed iteration override remaining, Ralph falls back to its default three-iteration configuration and invokes the configured agent three times instead of once.

## Expected Behavior

`parseFrontmatterData()` should reject unknown top-level configuration such as `iteratons` before applying a default iteration budget or starting any agent execution.

## Impact

A trivial frontmatter typo can multiply autonomous work, execution time, cost, and possible repository changes. A plan intended to permit one controlled iteration instead executes three iterations while appearing to have been accepted normally.
