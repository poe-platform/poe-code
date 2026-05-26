# Task list YAML-file proto task ID resolves a phantom task

## Summary

The task-list `yaml-file` backend accepts `__proto__` as a syntactically valid task ID, but retrieves task records from ordinary JavaScript objects without requiring an own property. For any persisted list, even an empty one, `get("__proto__")` resolves a fabricated task from the record object's prototype and `create({ id: "__proto__" })` rejects it as already existing even though no such YAML entry is stored.

## Reproduction

Create a disposable probe at `packages/task-list/src/backends/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { yamlFileBackend } from "./yaml-file.js";
import { createFs } from "./test-helpers.js";

describe("yaml-file inherited task ids", () => {
  it("returns an absent __proto__ task and blocks creating it in an empty persisted list", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning: {}",
        ""
      ].join("\n")
    });
    const taskList = await yamlFileBackend({
      path: "/repo/tasks.yaml",
      defaults: { metadata: {} },
      frontmatterMode: "strict",
      lockStaleMs: 30_000,
      lockRetries: 20,
      create: false,
      fs
    });
    const tasks = taskList.list("planning");

    await expect(tasks.all()).resolves.toEqual([]);
    await expect(tasks.get("__proto__")).resolves.toMatchObject({
      id: "__proto__",
      qualifiedId: "planning/__proto__",
      name: undefined,
      state: undefined
    });
    await expect(tasks.create({ id: "__proto__", name: "Proto" })).rejects.toThrow(
      'Task "planning/__proto__" already exists.'
    );
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
✓ packages/task-list/src/backends/__probe__.test.ts > yaml-file inherited task ids > returns an absent __proto__ task and blocks creating it in an empty persisted list

Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

`validateTaskId()` permits the identifier `"__proto__"`, and `getTaskRecord()` reads candidate records with `listRecord?.[id]` at `packages/task-list/src/backends/yaml-file.ts:369` through `packages/task-list/src/backends/yaml-file.ts:378`. For an empty persisted list parsed into an ordinary object, looking up the absent key `"__proto__"` returns `Object.prototype`, which passes the loose `isRecord()` test. `get()` therefore builds a `Task` whose `name` and `state` are `undefined`, while `create()` performs the same inherited lookup at `packages/task-list/src/backends/yaml-file.ts:536` through `packages/task-list/src/backends/yaml-file.ts:542` and rejects a valid new ID as if a task already existed. The list enumeration remains empty, confirming no `__proto__` task is stored.

## Expected Behavior

Task lookup and duplicate detection should consider only own persisted task entries. `get("__proto__")` should reject with `TaskNotFoundError` until that exact ID has been created, and `create({ id: "__proto__" })` should either store the task consistently or reject the ID at validation time before consulting inherited object properties.

## Impact

Projects cannot safely use a validator-approved task ID once any task exists in a YAML list, and consumers can receive fabricated task objects with invalid missing fields through a successful public read. Automation that trusts `get()` results or handles `TaskAlreadyExistsError` as persisted state can misclassify work, fail task creation, or operate on a task that has no representation in the source file.
