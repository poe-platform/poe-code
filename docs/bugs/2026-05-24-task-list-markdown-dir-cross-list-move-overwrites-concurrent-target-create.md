# Task list markdown-dir cross-list move overwrites concurrent target create

## Summary

The Markdown-directory backend checks whether the target list already contains a task ID before `moveBetweenLists()` begins, but it performs the subsequent target-directory scan and final `rename()` without acquiring the target list lock used by `create()`. A concurrent `create()` for the same ID can therefore succeed in the target list after the move's existence check, only for the in-progress move to overwrite that newly created task file when it renames the source into the same target path.

## Reproduction

From the repository root, run a disposable Vitest probe using `memfs`. The probe pauses `moveBetweenLists()` at its final source-to-target rename, creates the same ID in the target list while the move is paused, then releases the move:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import type { TaskListFs } from "../types.js";
import { markdownDirBackend } from "./backends/markdown-dir.js";
import { createDeferred, createFs } from "./backends/test-helpers.js";

describe("markdown-dir cross-list move locking", () => {
  it("overwrites a concurrent target-list create with the same id", async () => {
    const storage = createFs({ "/repo/tasks/.keep": "" });
    const moveAtRename = createDeferred();
    const releaseMove = createDeferred();
    let holdMove = false;
    const fs: TaskListFs = {
      ...storage.fs,
      rename: async (fromPath, toPath) => {
        if (holdMove && fromPath === "/repo/tasks/planning/01-shared.md") {
          moveAtRename.resolve();
          await releaseMove.promise;
        }
        await storage.fs.rename(fromPath, toPath);
      }
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks", defaults: { metadata: {} }, lockStaleMs: 30_000,
      lockRetries: 20, create: false, fs
    });
    await taskList.list("planning").create({ id: "shared", name: "Moved source" });

    holdMove = true;
    const moved = taskList.moveBetweenLists("planning/shared", "doing");
    await moveAtRename.promise;
    const created = await taskList.list("doing").create({ id: "shared", name: "Concurrent target" });
    releaseMove.resolve();
    await moved;

    const final = await taskList.list("doing").get("shared");
    console.log(JSON.stringify({ created: created.name, final: final.name }));
    expect(created.name).toBe("Concurrent target");
    expect(final.name).toBe("Moved source");
  });
});
EOF
trap 'rm -f packages/task-list/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
nl -ba packages/task-list/src/backends/markdown-dir.ts | sed -n '784,803p;872,913p;1163,1245p'
```

## Observed Behavior

The target-list create resolves successfully and returns its own task content, but after the paused move resumes, reading the target ID returns the moved source instead:

```text
{"created":"Concurrent target","final":"Moved source"}
✓ packages/task-list/src/__probe__.test.ts > markdown-dir cross-list move locking > overwrites a concurrent target-list create with the same id
```

Ordinary `create()` protects its target existence check and atomic write with `withListLock()` in `packages/task-list/src/backends/markdown-dir.ts:784` through `packages/task-list/src/backends/markdown-dir.ts:803` and `packages/task-list/src/backends/markdown-dir.ts:872` through `packages/task-list/src/backends/markdown-dir.ts:913`. In contrast, `moveBetweenLists()` performs its target-existence check at `packages/task-list/src/backends/markdown-dir.ts:1185` through `packages/task-list/src/backends/markdown-dir.ts:1188`, computes the destination filename, and renames into it at `packages/task-list/src/backends/markdown-dir.ts:1227` through `packages/task-list/src/backends/markdown-dir.ts:1245` without taking the target list's lock or rechecking whether the destination now exists.

## Expected Behavior

Cross-list moves should serialize with target-list creates and reject rather than overwrite when a same-ID target appears concurrently. Once `create({ id: "shared" })` has returned success for the target list, a concurrent move must not silently replace that task's contents.

## Impact

Concurrent automation moving tasks between lists while another process creates or restores a task can silently lose the newly created target record. Both operations appear successful, yet the target task's name, description, and metadata are replaced by the moving source, causing undetected task data loss and misleading workflow results.
