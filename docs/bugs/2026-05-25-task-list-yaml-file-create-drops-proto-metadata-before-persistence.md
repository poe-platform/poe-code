# Task-list YAML file create drops proto metadata before persistence

## Summary

The public YAML-file task backend accepts arbitrary non-reserved metadata in `Tasks.create()`, but silently loses an enumerable own metadata field named `__proto__` before the task is written. The resulting persisted task and the task returned by `create()` both omit a value the caller supplied without error.

## Reproduction

From the repository root, run this disposable Vitest probe using the backend's in-memory filesystem helper:

```sh
cat > packages/task-list/src/backends/__probe__.test.ts <<'TEST'
import { describe, expect, it } from "vitest";
import { openTaskList } from "../open.js";
import { createFs } from "./test-helpers.js";

function ownProtoMetadata(): Record<string, unknown> {
  return Object.fromEntries([["__proto__", { reviewer: "security" }]]);
}

describe("yaml-file write result metadata", () => {
  it("drops a supplied __proto__ metadata value before create persistence", async () => {
    const { fs, rawFs } = createFs();
    const taskList = await openTaskList({
      type: "yaml-file",
      path: "/repo/tasks.yaml",
      create: true,
      fs
    });
    const tasks = taskList.list("planning");

    const created = await tasks.create({ id: "create", name: "Create", metadata: ownProtoMetadata() });
    const reread = await tasks.get("create");
    const stored = await rawFs.readFile("/repo/tasks.yaml", "utf8");

    console.log(JSON.stringify({ stored, metadata: created.metadata, reread: reread.metadata }));
    expect(Object.hasOwn(created.metadata, "__proto__")).toBe(false);
    expect(created.metadata.reviewer).toBeUndefined();
    expect(Object.hasOwn(reread.metadata, "__proto__")).toBe(false);
    expect(reread.metadata.reviewer).toBeUndefined();
    expect(stored).not.toContain("reviewer");
  });
});
TEST
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
rm packages/task-list/src/backends/__probe__.test.ts
```

The probe passes and the printed YAML contains only the standard task fields, with no `reviewer` or `__proto__` entry:

```text
✓ packages/task-list/src/backends/__probe__.test.ts > yaml-file write result metadata > drops a supplied __proto__ metadata value before create persistence
```

## Observed Behavior

`createTaskRecord()` initializes a normal object for a new YAML task and copies caller-provided `input.metadata` entries through `taskRecord[key] = value` at `packages/task-list/src/backends/yaml-file.ts:133` through `packages/task-list/src/backends/yaml-file.ts:162`. When `key` is `__proto__`, assignment modifies the temporary record's prototype instead of defining serializable metadata. The public `create()` path then stores and returns that already-damaged record at `packages/task-list/src/backends/yaml-file.ts:524` through `packages/task-list/src/backends/yaml-file.ts:548`, so the submitted metadata never reaches the YAML document or the public task result.

## Expected Behavior

`Tasks.create()` should either persist accepted metadata as own task values or reject unsafe metadata keys explicitly. An enumerable own `__proto__` metadata field must not be accepted and silently discarded before storage.

## Impact

Callers creating YAML-backed tasks can receive successful results while losing submitted metadata permanently. Any workflow that relies on creation-time metadata for routing, ownership, review requirements, or automation may proceed with an incomplete stored task without knowing the requested value was dropped.
