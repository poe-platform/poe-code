# Task List YAML File State Write Failure Leaves OnExit Side Effect Committed

## Summary

The `yaml-file` task-list backend awaits an event's `onExit` callback before it publishes the destination state. If the subsequent atomic store replacement fails, `fire()` rejects and the task remains in its source state even though `onExit` has already performed its external side effect.

## Reproduction

Create a disposable probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { openTaskList } from "../open.js";
import { createFs } from "./test-helpers.js";

describe("yaml task transition onExit persistence failure probe", () => {
  it("leaves hook work committed when destination-state publication fails", async () => {
    const effects: string[] = [];
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
    const originalRename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (fromPath, toPath) => {
      if (toPath === "/repo/tasks.yaml") {
        throw new Error("injected state publication failure");
      }
      return originalRename(fromPath, toPath);
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
    await expect(rawFs.readFile("/repo/tasks.yaml", "utf8")).resolves.toContain("state: draft");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
```

The probe passes, proving that the pre-transition hook executes before failed state publication is returned. Remove the disposable probe afterward.

## Observed Behavior

`fire("task", "finish")` rejects with `injected state publication failure`. The `onExit` callback has already executed once (`effects` contains `"notified"`), but `/repo/tasks.yaml` still records `state: draft` because replacement of the store failed.

## Expected Behavior

Transition side effects and persisted state should remain consistent. If durable state publication cannot succeed after a hook runs, the API should compensate that hook, structure hooks after committed state where appropriate, or report an explicit partial transition rather than a generic failed `fire()` result.

## Impact

An `onExit` hook may send notifications, release resources, trigger automation, or mutate external systems for a transition that the task store says never occurred. Retrying the apparently failed event can repeat the external side effect while the source-state task remains fireable, causing duplicated and contradictory workflow actions.
