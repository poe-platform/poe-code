# Task list markdown-dir archive relocation failure commits archived state in active directory

## Summary

The Markdown-directory task-list backend handles an archive transition by first overwriting the active task file with `state: archived`, then creating the archive directory and renaming the file into it. If the final archive relocation fails, `fire(id, "archive")` rejects after the state update has already committed, leaving an archived-state task in the active directory and exposing it through the ordinary active-task listing path.

## Reproduction

From the repository root, run a disposable Vitest probe backed by `memfs` that allows ordinary atomic writes but rejects only the final rename into the archive directory:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import type { TaskListFs } from "../types.js";
import { markdownDirBackend } from "./backends/markdown-dir.js";
import { createFs } from "./backends/test-helpers.js";

describe("markdown-dir archive failure atomicity", () => {
  it("leaves an archived-state task in the active directory when archive relocation fails", async () => {
    const storage = createFs({ "/repo/tasks/.keep": "" });
    const fs: TaskListFs = {
      ...storage.fs,
      rename: vi.fn(async (fromPath, toPath) => {
        if (toPath === "/repo/tasks/planning/archive/ship.md") {
          throw new Error("archive relocation failed");
        }
        await storage.fs.rename(fromPath, toPath);
      })
    };
    const taskList = await markdownDirBackend({
      path: "/repo/tasks", defaults: { metadata: {} }, lockStaleMs: 30_000,
      lockRetries: 20, create: false, fs
    });
    const tasks = taskList.list("planning");
    await tasks.create({ id: "ship", name: "Ship" });

    await expect(tasks.fire("ship", "archive")).rejects.toThrow("archive relocation failed");

    const visible = await tasks.all();
    const activeFile = await storage.rawFs.readFile("/repo/tasks/planning/01-ship.md", "utf8");
    console.log(JSON.stringify({
      visible: visible.map((task) => ({ id: task.id, state: task.state })),
      activeArchived: activeFile.includes("state: archived")
    }));
    expect(visible).toMatchObject([{ id: "ship", state: "archived" }]);
    expect(activeFile).toContain("state: archived");
  });
});
EOF
trap 'rm -f packages/task-list/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
nl -ba packages/task-list/src/backends/markdown-dir.ts | sed -n '850,868p;943,1016p'
```

## Observed Behavior

The archive operation rejects, but the active Markdown file has already been rewritten with the archived state and remains returned by `all()` as an active entry:

```text
{"visible":[{"id":"ship","state":"archived"}],"activeArchived":true}
✓ packages/task-list/src/__probe__.test.ts > markdown-dir archive failure atomicity > leaves an archived-state task in the active directory when archive relocation fails
```

In `packages/task-list/src/backends/markdown-dir.ts:943` through `packages/task-list/src/backends/markdown-dir.ts:1016`, archive handling computes the archived frontmatter and writes it to `existing.path` at line 976 before `mkdir()` and the relocation `rename()` at lines 977 through 978. When the relocation rejects, there is no rollback of the already-written active file. The normal listing implementation reads active entries independently of archive placement in `packages/task-list/src/backends/markdown-dir.ts:850` through `packages/task-list/src/backends/markdown-dir.ts:868`, so the failed operation leaves the task visible through the active path while its state says it is archived.

## Expected Behavior

An archive transition that rejects before the task reaches its archive location should leave the original active task and state unchanged, or should complete the archive movement atomically before returning success. A failed relocation must not commit a logically archived state in the active directory.

## Impact

A transient filesystem error, permission failure, or interrupted relocation can cause callers to receive an archive failure while task state has already changed. Subsequent active listings contain tasks marked archived in the wrong location, filtering and ordering can become inconsistent with the storage layout, and retrying or repairing the operation requires diagnosing a partially committed transition.
