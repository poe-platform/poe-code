# Pipeline lock release failure rejects a persisted successful task

## Summary

The exported `@poe-code/pipeline` `runPipeline()` operation writes a successful task's `status: done` to the plan while holding its workflow lock, then awaits the lock release callback in a `finally` block. If releasing the lock rejects, `runPipeline()` rejects after the successful task status has already been durably written.

## Reproduction

1. Add this disposable probe as `packages/pipeline/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";

const lockWorkflow = vi.hoisted(() =>
  vi.fn(async () => async () => {
    throw new Error("lock release denied");
  })
);

vi.mock("@poe-code/agent-harness-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/agent-harness-tools")>()),
  lockWorkflow
}));

import { runPipeline } from "./run/pipeline.js";
import type { PipelineFileSystem } from "./types.js";

describe("pipeline lock release failure probe", () => {
  it("rejects after persisting a successful task status when release fails", async () => {
    const planPath = "/repo/docs/plans/plan.md";
    const rawFs = createFsFromVolume(
      Volume.fromJSON({
        [planPath]: [
          "---",
          "kind: pipeline",
          "version: 1",
          "tasks:",
          "  - id: task-1",
          "    title: Task one",
          "    prompt: Do the work",
          "    status: open",
          "---",
          ""
        ].join("\n")
      }, "/")
    ).promises;
    const fs = {
      readFile: (filePath: string, encoding: BufferEncoding) => rawFs.readFile(filePath, encoding),
      writeFile: (filePath: string, data: string, options?: { encoding?: BufferEncoding }) =>
        rawFs.writeFile(filePath, data, options),
      readdir: (filePath: string) => rawFs.readdir(filePath),
      open: (filePath: string, flags: string) => rawFs.open(filePath, flags),
      stat: async (filePath: string) => {
        const stat = await rawFs.stat(filePath);
        return {
          isFile: () => stat.isFile(),
          isDirectory: () => stat.isDirectory(),
          mtimeMs: Number(stat.mtimeMs)
        };
      },
      unlink: (filePath: string) => rawFs.unlink(filePath),
      mkdir: (filePath: string, options?: { recursive?: boolean }) => rawFs.mkdir(filePath, options),
      rmdir: (filePath: string) => rawFs.rmdir(filePath),
      rename: (oldPath: string, newPath: string) => rawFs.rename(oldPath, newPath)
    } as PipelineFileSystem;

    await expect(
      runPipeline({
        agent: "codex",
        cwd: "/repo",
        homeDir: "/home/test",
        plan: path.relative("/repo", planPath),
        maxRuns: 1,
        fs,
        runAgent: async () => ({ stdout: "", stderr: "", exitCode: 0 })
      })
    ).rejects.toThrow("lock release denied");

    await expect(fs.readFile(planPath, "utf8")).resolves.toContain("status: done");
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline lock release failure probe > rejects after persisting a successful task status when release fails
```

## Observed Behavior

The mocked agent run exits successfully and `runPipeline()` writes `status: done` for `task-1` into the plan. It then invokes the workflow lock release callback, which rejects with `lock release denied`. The exported operation rejects with that cleanup error despite the task having already been persisted as successfully completed.

## Expected Behavior

A lock-release failure after a committed task update should not silently replace the authoritative task-execution outcome. The API should either return the successful task result while separately surfacing cleanup trouble, or represent both states explicitly without presenting committed success as an ordinary failed execution.

## Impact

Transient lock-file cleanup failures can make automation retry task work whose successful status is already stored in the plan. Callers observe a rejected pipeline invocation while later readers observe a completed task, producing contradictory run state and risking duplicate side effects or incorrect failure escalation.
