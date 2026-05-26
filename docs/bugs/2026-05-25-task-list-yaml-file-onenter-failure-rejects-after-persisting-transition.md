# Task List YAML File OnEnter Failure Rejects After Persisting Transition

## Summary

The `yaml-file` task-list backend persists a fired state transition before awaiting the configured event `onEnter` callback. If `onEnter` rejects, `fire()` reports failure after the task has already advanced in the YAML store, so callers receive an error for a transition that durably occurred.

## Reproduction

Create a disposable probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openTaskList } from "../open.js";
import { createFs } from "./test-helpers.js";

describe("task transition onEnter failure probe", () => {
  it("rejects after persisting the destination state", async () => {
    const { fs, rawFs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning:",
        "    task:",
        "      name: Task",
        "      state: draft",
        "      description: ''",
        ""
      ].join("\n")
    });
    const taskList = await openTaskList({
      type: "yaml-file",
      path: "/repo/tasks.yaml",
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
    await expect(rawFs.readFile("/repo/tasks.yaml", "utf8")).resolves.toContain("state: done");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
```

The probe passes, proving the transition is stored before callback failure is surfaced. Remove the disposable probe afterward.

## Observed Behavior

`taskList.list("planning").fire("task", "finish")` rejects with `injected onEnter failure`, but `/repo/tasks.yaml` already contains `state: done`. The callback failure prevents a successful return value without undoing the persisted task transition.

## Expected Behavior

A transition callback failure should not make `fire()` reject after silently committing the destination state, unless the API explicitly exposes that the transition succeeded and only a follow-up hook failed. The backend should either run the required hook before committing state or compensate for a failed post-transition hook.

## Impact

Callers may retry a transition they believe failed and encounter invalid-transition errors or run duplicate external actions, because durable task state no longer matches the rejected result. Workflow orchestrators cannot reliably determine whether a failed `fire()` changed the task store without rereading and reconciling state manually.
