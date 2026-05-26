# Ralph unknown hook strategy key runs implicit behavior

## Summary

The exported `@poe-code/ralph` document schema forbids unknown properties within hook configurations, but `parseFrontmatterData()` ignores them. A plan that misspells `hooks.strategy: transform` as `hooks.stratgey: transform` is accepted and invokes its agent with hooks that omit the requested strategy.

## Reproduction

Create the following disposable probe at `packages/ralph/src/__probe__.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { runRalph } from "./run/ralph.js";

it("ignores a misspelled hook strategy and forwards implicit behavior", async () => {
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
          "  stratgey: transform",
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
✓ packages/ralph/src/__probe__.test.ts > ignores a misspelled hook strategy and forwards implicit behavior
```

## Observed Behavior

`packages/ralph/src/frontmatter/frontmatter.ts` publishes hook objects with `additionalProperties: false`, recognizing `from`, `strategy`, and `scope`. Its `parseHooks()` function validates only recognized properties and never rejects unknown `stratgey`. The normalized Ralph configuration therefore retains `{ from: "hook-pack" }` but drops its apparent `transform` strategy, which `runRalph()` forwards to the agent.

## Expected Behavior

`parseFrontmatterData()` should reject unknown hook keys such as `stratgey` before running an iteration with altered hook-installation behavior.

## Impact

A minor hook configuration typo can change the instructions or files exposed to a Ralph agent by silently removing an explicitly requested strategy. This can produce different edits, safety properties, or workspace effects while the document is accepted and executed normally.
