# Task List Markdown Dir OnEnter Failure Rejects After Persisting Transition

## Summary

The `markdown-dir` task-list backend writes a task's destination state to its Markdown file before awaiting the configured event `onEnter` callback. If `onEnter` rejects, `fire()` reports failure even though the state transition has already been durably persisted in the task document.

## Reproduction

Create a disposable probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openTaskList } from "../open.js";
import { createFs } from "./test-helpers.js";

describe("markdown task transition onEnter failure probe", () => {
  it("rejects after persisting the destination state", async () => {
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
            onEnter: async () => {
              throw new Error("injected onEnter failure");
            }
          }
        }
      }
    });

    await expect(taskList.list("planning").fire("task", "finish")).rejects.toThrow(
      "injected onEnter failure"
    );
    await expect(rawFs.readFile("/repo/tasks/planning/task.md", "utf8")).resolves.toContain(
      "state: done"
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
```

The probe passes, proving that the Markdown state update survives the rejected callback. Remove the disposable probe afterward.

## Observed Behavior

`taskList.list("planning").fire("task", "finish")` rejects with `injected onEnter failure`, but `/repo/tasks/planning/task.md` already contains `state: done`. The callback error is surfaced after the backend has committed the state transition to disk.

## Expected Behavior

A failed post-transition callback should not make `fire()` appear wholly unsuccessful after persisting the transition, unless the API explicitly returns a partial-success outcome. The backend should defer the durable state update until required hooks succeed or compensate when an `onEnter` hook fails.

## Impact

Callers may retry a transition that has already occurred and trigger invalid-transition behavior or duplicate external work. Because Markdown-backed task state no longer matches the rejected `fire()` result, orchestrators must reread task files after hook failures to determine the true workflow state.
