# Task-list markdown-dir reorder failure hides an active task in a staging file

## Summary

`@poe-code/task-list`'s `markdown-dir` backend implements `reorder()` by renaming every affected active task into a hidden `.staging-*` filename, then renaming those staged entries into their final ordered filenames. If a later final rename rejects after an earlier final rename succeeds, `reorder()` rejects with a partially committed directory: one task has its new priority filename, unchanged entries remain active, and at least one valid active task is left only under a hidden staging filename. Public reads skip hidden entries, so the failed operation makes a task disappear from the list even though its document still exists on disk.

## Reproduction

Create a disposable Vitest probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { markdownDirBackend } from "./markdown-dir.js";
import { createFs } from "./test-helpers.js";

describe("markdown-dir reorder rename failure probe", () => {
  it("strands an active task as a hidden staging file", async () => {
    const baseFs = createFs({
      "/repo/tasks/planning/01-alpha.md": `---\nname: Alpha\nstate: draft\n---\n`,
      "/repo/tasks/planning/02-bravo.md": `---\nname: Bravo\nstate: draft\n---\n`,
      "/repo/tasks/planning/03-charlie.md": `---\nname: Charlie\nstate: draft\n---\n`
    });
    let committedRenames = 0;
    const fs = {
      ...baseFs.fs,
      rename: async (fromPath: string, toPath: string) => {
        if (fromPath.includes(".staging-") && !toPath.includes(".staging-")) {
          committedRenames += 1;
          if (committedRenames === 2) {
            throw new Error("simulated rename failure");
          }
        }
        await baseFs.fs.rename(fromPath, toPath);
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

    await expect(
      taskList.list("planning").reorder(["charlie", "bravo", "alpha"])
    ).rejects.toThrow("simulated rename failure");

    await expect(taskList.list("planning").all()).resolves.toMatchObject([
      { id: "bravo" },
      { id: "alpha" }
    ]);
    await expect(baseFs.rawFs.readdir("/repo/tasks/planning")).resolves.toEqual(
      expect.arrayContaining([expect.stringContaining("01-charlie.md.staging-")])
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

- `taskList.list("planning").reorder(["charlie", "bravo", "alpha"])` rejects after the injected failure on the second staged-to-final rename.
- A subsequent public `all()` read returns only `bravo` and `alpha`; the existing `charlie` task is no longer visible through the backend.
- The underlying directory still contains Charlie's task document as a hidden staging entry named like `01-charlie.md.staging-<pid>-<index>`.
- The staging implementation is in `packages/task-list/src/backends/markdown-dir.ts`: `renameActiveEntries()` first moves changed files to `.staging-*` paths and then commits each final rename sequentially. Normal active scans ignore hidden entries, so a staged task stranded by a final rename failure is excluded from reads.

## Expected Behavior

A failed `reorder()` should not cause any active task to disappear from normal reads or leave an incompletely reordered list. The backend should either commit the requested filename ordering atomically from the caller's perspective, or recover/roll back all staged entries before surfacing the failure.

## Impact

A transient filesystem rename failure during task prioritization can hide a valid active task from CLI, SDK, and automation consumers while still leaving its file behind under an implementation-only staging name. Users may believe work was deleted or omit it from planning and execution until they manually inspect and repair the task directory.
