# Agent harness reads workflow before lock and executes stale document

## Summary

`@poe-code/agent-harness-tools` reads and parses the workflow document before acquiring its execution lock. If another locked process changes the workflow while a runner is waiting for the lock, the waiting runner executes the stale pre-lock configuration after the newer document has already been committed to disk.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/agent-harness-tools/src/__probe__.test.ts <<'PROBE'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { acquireFileLock } from "@poe-code/file-lock";
import { runDocumentWorkflow } from "./runner.js";

describe("workflow lock/read ordering", () => {
  it("executes the pre-lock document after a locked writer replaces it", async () => {
    const volume = Volume.fromJSON({ "/repo/workflow.md": "old" }, "/");
    const fs = createFsFromVolume(volume).promises as any;
    const prompts: string[] = [];
    let resolveRead!: () => void;
    const readCompleted = new Promise<void>((resolve) => {
      resolveRead = resolve;
    });
    const releaseWriterLock = await acquireFileLock("/repo/workflow.md", { fs });

    const runPromise = runDocumentWorkflow({
      cwd: "/repo",
      homeDir: "/home/test",
      docPath: "/repo/workflow.md",
      fs,
      async readConfig(content) {
        resolveRead();
        return {
          frontmatter: {
            participants: { default: { agent: "claude", mode: "edit" } },
            stages: [{ id: "work", participant: "default", prompt: content }],
            max_iterations: 1
          },
          body: ""
        };
      },
      runAgent: vi.fn(async (input) => {
        prompts.push(input.prompt);
        return { exitCode: 0 };
      })
    });

    await readCompleted;
    await fs.writeFile("/repo/workflow.md", "new", "utf8");
    await releaseWriterLock();
    await runPromise;

    console.log(JSON.stringify({ document: await fs.readFile("/repo/workflow.md", "utf8"), prompts }));
    expect(prompts).toEqual(["old"]);
  });
});
PROBE
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

Output:

```text
{"document":"new","prompts":["old"]}
✓ packages/agent-harness-tools/src/__probe__.test.ts > workflow lock/read ordering > executes the pre-lock document after a locked writer replaces it
```

## Observed Behavior

`runDocumentWorkflow()` loads `initialWorkflow` from the document at `packages/agent-harness-tools/src/runner.ts:308` and only afterward waits for the lock at `packages/agent-harness-tools/src/runner.ts:309`. The lock implementation waits until the existing holder releases the lock in `packages/file-lock/src/lock.ts:230` through `packages/file-lock/src/lock.ts:282`. In the reproduction, a writer already owns that lock, the runner reads `old`, the locked writer changes the document to `new` and releases the lock, and the runner then executes prompt `old` from its stale `initialWorkflow` at `packages/agent-harness-tools/src/runner.ts:319` through `packages/agent-harness-tools/src/runner.ts:339`.

## Expected Behavior

A runner that waits behind a workflow lock should read the workflow after acquiring that lock, or re-read it immediately after acquisition, so it executes the currently committed document rather than configuration invalidated by a preceding locked operation.

## Impact

Concurrent workflow execution or management can run agent instructions that an earlier lock holder has already changed or removed. A stale runner can perform unintended edits, spend model/tool resources on superseded work, or bypass an operator update that was meant to alter or stop the next run.
