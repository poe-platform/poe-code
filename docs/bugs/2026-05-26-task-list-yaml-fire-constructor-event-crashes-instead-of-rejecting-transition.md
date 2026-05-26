# Task list YAML fire constructor event crashes instead of rejecting transition

## Summary

The public `@poe-code/task-list` YAML backend accepts arbitrary event names through `Tasks.fire()`, but event lookup reads a normal JavaScript object without requiring an own configured event. Firing the unconfigured event name `"constructor"` retrieves `Object.prototype.constructor` and crashes with an implementation-level property-access error instead of returning the package's normal invalid-transition error.

## Reproduction

Create a disposable probe at `packages/task-list/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFs } from "./backends/test-helpers.js";
import { openTaskList } from "./open.js";

describe("task-list inherited event name handling", () => {
  it("throws an implementation error for the unconfigured constructor event", async () => {
    const { fs } = createFs();
    const taskList = await openTaskList({
      type: "yaml-file",
      path: "/repo/tasks.yaml",
      create: true,
      fs
    });
    const tasks = taskList.list("planning");
    await tasks.create({ id: "ship", name: "Ship" });

    await expect(tasks.fire("ship", "constructor")).rejects.toThrow(
      "Cannot read properties of undefined"
    );
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/task-list/src/__probe__.test.ts --reporter verbose
rm -f packages/task-list/src/__probe__.test.ts
```

The probe passes, confirming that an absent prototype-named event fails through an implementation exception rather than normal transition rejection:

```text
✓ packages/task-list/src/__probe__.test.ts > task-list inherited event name handling > throws an implementation error for the unconfigured constructor event
```

## Observed Behavior

`openTaskList()` exposes the YAML backend through the public package entry point at `packages/task-list/src/index.ts:1`. The YAML `fire()` implementation passes its caller-supplied event name into `assertFireableTaskEvent()` at `packages/task-list/src/backends/yaml-file.ts:506` through `packages/task-list/src/backends/yaml-file.ts:518` and `packages/task-list/src/backends/yaml-file.ts:578` through `packages/task-list/src/backends/yaml-file.ts:586`. That helper delegates to exported `findEvent()`, which reads `machine.events[eventName]` directly at `packages/task-list/src/state-machine.ts:98` through `packages/task-list/src/state-machine.ts:110`. For the default machine and `eventName === "constructor"`, the read yields the inherited `Object` constructor instead of `undefined`; `canFireFromState()` then attempts to read its missing `from` field and crashes. Ordinary unknown event names instead reach `InvalidTransitionError` construction in `assertFireableTaskEvent()`.

## Expected Behavior

Only own declared event definitions should be fireable. Calling `tasks.fire(id, "constructor")` when no such event exists must reject with the same structured `InvalidTransitionError` used for any other unknown or invalid event name, not expose an implementation exception from prototype inheritance.

## Impact

SDK or CLI integrations that forward a user-selected event name can trigger unexpected native errors for a valid string input, bypassing normal task-list error handling and structured diagnostics. This makes behavior depend on JavaScript prototype property names and can break automation that expects invalid transitions to be classified and reported consistently.
