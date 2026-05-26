# Task-list markdown-dir cross-list move read failure rejects after relocation

## Summary

`@poe-code/task-list`'s `markdown-dir` implementation of `moveBetweenLists()` renames an active task into its destination list before it reads and parses the moved file to produce the return value. If that post-rename read fails, the public move operation rejects even though the task has already been removed from its source list and durably installed in the target list. Callers receive a failure result for an operation whose primary mutation has already occurred.

## Reproduction

Create a disposable Vitest probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { markdownDirBackend } from "./markdown-dir.js";
import { createFs } from "./test-helpers.js";

describe("markdown-dir cross-list post-move read failure probe", () => {
  it("rejects after relocating a valid active task when target verification read fails", async () => {
    const baseFs = createFs({
      "/repo/tasks/planning/01-shared.md": `---\nname: Shared\nstate: draft\n---\nValid body`,
      "/repo/tasks/doing/01-existing.md": `---\nname: Existing\nstate: draft\n---\n`
    });
    let renamed = false;
    const fs = {
      ...baseFs.fs,
      rename: async (fromPath: string, toPath: string) => {
        await baseFs.fs.rename(fromPath, toPath);
        if (fromPath === "/repo/tasks/planning/01-shared.md") renamed = true;
      },
      readFile: async (filePath: string, encoding: BufferEncoding) => {
        if (renamed && filePath === "/repo/tasks/doing/02-shared.md") {
          throw new Error("simulated target read failure");
        }
        return baseFs.fs.readFile(filePath, encoding);
      }
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks",
      defaults: { metadata: {} },
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs,
      frontmatterMode: "strict"
    });

    await expect(taskList.moveBetweenLists("planning/shared", "doing")).rejects.toThrow(
      "simulated target read failure"
    );
    await expect(baseFs.rawFs.stat("/repo/tasks/planning/01-shared.md")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(baseFs.rawFs.readFile("/repo/tasks/doing/02-shared.md", "utf8")).resolves.toContain(
      "Valid body"
    );
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/task-list/src/backends/__probe__.test.ts` afterward.

## Observed Behavior

- A valid `planning/shared` task exists, and `doing` already contains one task so the moved target path is `/repo/tasks/doing/02-shared.md`.
- The injected filesystem permits the source-to-target rename, then throws only when the backend performs its immediate target read.
- `taskList.moveBetweenLists("planning/shared", "doing")` rejects with `simulated target read failure`.
- After rejection, the original source path no longer exists and the valid document is present at the destination path, proving the cross-list relocation committed before the reported failure.
- In `packages/task-list/src/backends/markdown-dir.ts`, the active-task branch calls `deps.fs.rename(sourceLocation.path, targetPath)` and only then calls `readTaskFile(...)` to return the moved task.

## Expected Behavior

A public move that reports failure should not leave the task already relocated without explicitly communicating that committed outcome. The backend should read/validate the source before mutation and avoid post-commit failure points where possible, or provide rollback/committed-result handling if final verification cannot be completed.

## Impact

Transient read errors after rename can cause callers to retry a move they believe failed, while the task has already changed lists. This can yield confusing not-found or duplicate-task errors on retry and cause automation, dashboards, or humans to act on an incorrect view of where work currently resides.
