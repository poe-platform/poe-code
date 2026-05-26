# Task List Markdown Dir State Write Failure Leaves OnExit Side Effect Committed

## Summary

The `markdown-dir` task-list backend awaits an event's `onExit` callback before it atomically replaces the task Markdown document with the destination state. If that later state publication fails, `fire()` rejects while the hook side effect has already occurred and the task file still records the source state.

## Reproduction

Create a disposable probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { openTaskList } from "../open.js";
import { createFs } from "./test-helpers.js";

describe("markdown task transition onExit persistence failure probe", () => {
  it("leaves hook work committed when destination-state publication fails", async () => {
    const effects: string[] = [];
    const { fs, rawFs } = createFs({
      "/repo/tasks/planning/task.md": [
        "---",
        "name: Task",
        "state: draft",
        "---",
        "",
        "Description"
      ].join("\n")
    });
    const originalRename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (fromPath, toPath) => {
      if (toPath === "/repo/tasks/planning/task.md") {
        throw new Error("injected state publication failure");
      }
      return originalRename(fromPath, toPath);
    });
    const taskList = await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      fs,
      stateMachine: {
        initial: "draft",
        states: ["draft", "done"],
        events: {
          finish: {
            from: ["draft"],
            to: "done",
            onExit: async () => {
              effects.push("notified");
            }
          }
        }
      }
    });

    await expect(taskList.list("planning").fire("task", "finish")).rejects.toThrow(
      "injected state publication failure"
    );
    expect(effects).toEqual(["notified"]);
    await expect(rawFs.readFile("/repo/tasks/planning/task.md", "utf8")).resolves.toContain(
      "state: draft"
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
```

The probe passes, proving that `onExit` work is committed before the Markdown state-write failure is surfaced. Remove the disposable probe afterward.

## Observed Behavior

`fire("task", "finish")` rejects with `injected state publication failure`, but `effects` contains `"notified"`, proving that `onExit` has executed. The live task Markdown remains `state: draft` because the atomic replacement failed after the side effect.

## Expected Behavior

Task transition side effects and durable Markdown state should not diverge on an ordinary persistence failure. The backend should avoid irreversible pre-commit hooks, compensate them if publication fails, or expose an explicit partial-transition outcome instead of reporting only failure.

## Impact

Hooks may issue notifications, trigger external automation, or release workflow resources for a transition that remains absent from the Markdown task store. Since the source state remains fireable, retrying the rejected event can repeat the external work and create duplicated or contradictory effects.
