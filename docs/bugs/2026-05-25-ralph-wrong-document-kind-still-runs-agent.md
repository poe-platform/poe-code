# Ralph wrong document kind still runs agent

## Summary

The exported `@poe-code/ralph` runtime publishes a Ralph document schema that requires `kind: ralph`, but its frontmatter parser ignores the `kind` field entirely. Calling `runRalph()` on a document that explicitly declares `kind: experiment` therefore proceeds as a valid Ralph workflow and invokes the selected agent.

## Reproduction

Create the following disposable probe at `packages/ralph/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runRalph } from "./run/ralph.js";

describe("Ralph wrong document kind", () => {
  it("runs an agent for a plan declaring kind: experiment", async () => {
    const rawFs = createFsFromVolume(Volume.fromJSON({
      "/repo/.poe-code/ralph/plans/plan.md": [
        "---",
        "kind: experiment",
        "version: 1",
        "agent: codex",
        "iterations: 1",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Wrong workflow"
      ].join("\n")
    }, "/")).promises;
    const fs = {
      readFile: (filePath: string, encoding: BufferEncoding) => rawFs.readFile(filePath, encoding) as Promise<string>,
      writeFile: (filePath: string, content: string) => rawFs.writeFile(filePath, content, "utf8"),
      readdir: (filePath: string) => rawFs.readdir(filePath) as Promise<string[]>,
      open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
      stat: async (filePath: string) => {
        const stat = await rawFs.stat(filePath);
        return { isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory(), mtimeMs: stat.mtimeMs };
      },
      mkdir: (filePath: string, options: { recursive: boolean }) => rawFs.mkdir(filePath, options),
      rename: (oldPath: string, newPath: string) => rawFs.rename(oldPath, newPath),
      unlink: (filePath: string) => rawFs.unlink(filePath)
    };
    const runAgent = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));

    const result = await runRalph({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: ".poe-code/ralph/plans/plan.md",
      fs,
      runAgent
    });

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(result.iterationsCompleted).toBe(1);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/ralph/src/__probe__.test.ts --reporter verbose
rm packages/ralph/src/__probe__.test.ts
```

The probe passes and records:

```text
✓ packages/ralph/src/__probe__.test.ts > Ralph wrong document kind > runs an agent for a plan declaring kind: experiment
```

## Observed Behavior

`packages/ralph/src/index.ts` exports both `ralphDocumentSchema` and `runRalph()`. The schema declares `kind: { const: "ralph" }` and requires the `kind` field, but `parseFrontmatterData()` in `packages/ralph/src/frontmatter/frontmatter.ts` normalizes only execution fields such as `agent`, `iterations`, `skills`, hooks, and status. `runRalph()` then consumes this normalized configuration and enters `runDocumentWorkflow()` without validating the source document kind. In the probe, an explicitly `kind: experiment` plan invokes the agent once and completes a Ralph iteration.

## Expected Behavior

`runRalph()` should reject documents whose frontmatter declares a workflow kind other than `ralph` before resolving execution configuration, writing workflow state, or invoking any agent.

## Impact

A document intended for another autonomous workflow can be executed under Ralph semantics when selected through the wrong command or SDK path. That can run an unintended agent loop, rewrite or archive the document using Ralph status conventions, and bypass the workflow-type guard promised by the published schema.
