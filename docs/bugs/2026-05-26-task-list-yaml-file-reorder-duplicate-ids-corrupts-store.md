# Task list YAML-file reorder with duplicate IDs corrupts the store

## Summary

The task-list `yaml-file` backend accepts duplicate task IDs in `reorder()` as long as every active task appears at least once. It then serializes the same YAML mapping pair multiple times, reports success to the caller, and leaves the store unreadable by the backend on the next operation.

## Reproduction

Create a disposable probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { yamlFileBackend } from "./yaml-file.js";
import { createFs } from "./test-helpers.js";

describe("yaml-file reorder duplicate ids", () => {
  it("accepts duplicate ids and corrupts the persisted YAML store", async () => {
    const { fs } = createFs();
    const taskList = await yamlFileBackend({
      path: "/repo/tasks.yaml",
      defaults: { metadata: {} },
      frontmatterMode: "strict",
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: true,
      fs
    });
    const tasks = taskList.list("planning");

    await tasks.create({ id: "alpha", name: "Alpha" });
    await tasks.create({ id: "bravo", name: "Bravo" });

    await expect(tasks.reorder(["alpha", "bravo", "bravo"])).resolves.toHaveLength(3);
    await expect(tasks.all()).rejects.toThrow('Malformed task store "/repo/tasks.yaml": invalid "yaml".');
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
rm packages/task-list/src/backends/__probe__.test.ts
```

The probe passes:

```text
✓ packages/task-list/src/backends/__probe__.test.ts > yaml-file reorder duplicate ids > accepts duplicate ids and corrupts the persisted YAML store

Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

In `packages/task-list/src/backends/yaml-file.ts:694` through `packages/task-list/src/backends/yaml-file.ts:701`, `reorder()` checks membership with `Set` objects: duplicate input IDs are collapsed for the missing-item check, while each duplicate is still a known current ID for the extra-item check. The input `["alpha", "bravo", "bravo"]` therefore passes validation for active tasks `["alpha", "bravo"]`. The implementation then maps every supplied ID back to a YAML pair and splices all three values into `listNode.items` at `packages/task-list/src/backends/yaml-file.ts:708` through `packages/task-list/src/backends/yaml-file.ts:717`, writing a mapping with the same `bravo` key twice. `reorder()` resolves successfully with three tasks, but the subsequent `tasks.all()` read rejects the store as malformed YAML.

## Expected Behavior

`reorder()` should require each active task ID exactly once and reject duplicate IDs with `OrderMismatchError` before writing any state. A successful reorder must leave the YAML store readable and return the persisted order.

## Impact

Any caller that accidentally submits a duplicate ID can corrupt its task store through a nominally successful API call. Subsequent reads and task operations fail until the YAML file is repaired manually, interrupting workflow automation and making the successful mutation response misleading for retries or recovery logic.
