# Task list exported default state machine mutation redirects future transitions

## Summary

The exported `@poe-code/task-list` `defaultStateMachine` object is a live mutable workflow definition that is also reused internally whenever callers omit a custom state machine. Mutating its exported `plan` event target changes the persisted state produced by later default task-list operations in the same process.

## Reproduction

Create a disposable probe at `packages/task-list/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFs } from "./backends/test-helpers.js";
import { openTaskList } from "./open.js";
import { defaultStateMachine } from "./state.js";

describe("task-list exported default workflow mutation", () => {
  it("redirects future default plan transitions", async () => {
    const event = defaultStateMachine.events.plan as { to: string };
    const originalTarget = event.to;
    event.to = "archived";

    try {
      const { fs } = createFs();
      const taskList = await openTaskList({
        type: "yaml-file",
        path: "/repo/tasks.yaml",
        create: true,
        fs
      });
      const tasks = taskList.list("planning");
      await tasks.create({ id: "ship", name: "Ship" });

      await expect(tasks.fire("ship", "plan")).resolves.toMatchObject({
        state: "archived"
      });
    } finally {
      event.to = originalTarget;
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
rm -f packages/task-list/src/__probe__.test.ts
```

The probe passes, confirming that a prior mutation of exported workflow metadata redirects a subsequent default `plan` operation:

```text
✓ packages/task-list/src/__probe__.test.ts > task-list exported default workflow mutation > redirects future default plan transitions
```

## Observed Behavior

`defaultStateMachine` is declared as a normal nested object at `packages/task-list/src/state.ts:10` through `packages/task-list/src/state.ts:19` and publicly re-exported at `packages/task-list/src/index.ts:2`. `resolveStateMachine()` returns that exact object for callers without custom workflow configuration at `packages/task-list/src/state.ts:50` through `packages/task-list/src/state.ts:53`. `openTaskList()` passes the live default machine into file backends at `packages/task-list/src/open.ts:45` through `packages/task-list/src/open.ts:65`, and the YAML backend applies event targets from that same object when firing tasks at `packages/task-list/src/backends/yaml-file.ts:484` through `packages/task-list/src/backends/yaml-file.ts:523`. After an unrelated consumer assigns `defaultStateMachine.events.plan.to = "archived"`, a newly opened default task list persists an ordinary `plan` event directly from `draft` to `archived` rather than to `planned`.

## Expected Behavior

Public inspection of the default task workflow must not alter the transition behavior used by later task-list instances. The exported default state machine should be deeply immutable or internal runtime operations should use an independent immutable/defensive representation, so `plan` continues to mean `draft` to `planned` unless a caller explicitly supplies a custom state machine.

## Impact

Any same-process library, plugin, or UI that reads and accidentally modifies the exported workflow definition can silently change future persisted task state across callers. Routine planning actions can skip required intermediate states, archive tasks unexpectedly, violate orchestration assumptions, and make task behavior depend on unrelated code executed earlier in the process.
