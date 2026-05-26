# Task-list YAML file update and fire return results without persisted proto metadata

## Summary

The public YAML-file task backend persists an enumerable own `__proto__` metadata field supplied through `Tasks.update()` or `Tasks.fire(..., { metadataPatch })`, but immediately returns a `Task` result whose `metadata` omits the value that was just written. Successful mutations therefore return task state inconsistent with their resulting stored document.

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

describe("yaml-file returned write results", () => {
  it("omits persisted __proto__ metadata from update and fire results", async () => {
    const { fs, rawFs } = createFs();
    const taskList = await openTaskList({ type: "yaml-file", path: "/repo/tasks.yaml", create: true, fs });
    const tasks = taskList.list("planning");

    await tasks.create({ id: "update", name: "Update" });
    const updated = await tasks.update("update", { metadata: ownProtoMetadata() });
    await tasks.create({ id: "fire", name: "Fire" });
    const fired = await tasks.fire("fire", "plan", { metadataPatch: ownProtoMetadata() });
    const stored = await rawFs.readFile("/repo/tasks.yaml", "utf8");

    console.log(JSON.stringify({ updated: updated.metadata, fired: fired.metadata, stored }));
    expect(Object.hasOwn(updated.metadata, "__proto__")).toBe(false);
    expect(updated.metadata.reviewer).toBeUndefined();
    expect(Object.hasOwn(fired.metadata, "__proto__")).toBe(false);
    expect(fired.metadata.reviewer).toBeUndefined();
    expect(stored.match(/__proto__: \{ reviewer: security \}/g)).toHaveLength(2);
  });
});
TEST
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
rm packages/task-list/src/backends/__probe__.test.ts
```

The probe passes and prints returned metadata as empty objects while the serialized YAML includes both submitted `__proto__` entries:

```text
✓ packages/task-list/src/backends/__probe__.test.ts > yaml-file returned write results > omits persisted __proto__ metadata from update and fire results
```

## Observed Behavior

`buildUpdatedTaskRecord()` and `buildFiredTaskRecord()` create ordinary result records and copy caller metadata through `nextTaskRecord[key] = value` at `packages/task-list/src/backends/yaml-file.ts:185` through `packages/task-list/src/backends/yaml-file.ts:224`. For `__proto__`, those in-memory records lose the own metadata value. However, the public mutation methods independently apply the original caller metadata to the YAML `Document` through `document.setIn(["lists", list, id, key], value)` at `packages/task-list/src/backends/yaml-file.ts:550` through `packages/task-list/src/backends/yaml-file.ts:618`, which successfully serializes the `__proto__` field. Both methods then return `createTask(..., nextTaskRecord, ...)`, exposing metadata that no longer matches the written task document.

## Expected Behavior

A successful `update()` or `fire()` return value should describe the task state committed by that operation. If `__proto__` metadata is persistable, it should be represented consistently in the returned task; if it is unsupported, the mutation should reject or avoid writing it rather than return a contradictory result.

## Impact

Consumers can make follow-up decisions from the task returned by a successful update or transition and observe metadata absent even though it has already been stored. This breaks immediate mutation-read consistency, complicates auditing and UI refresh behavior, and can cause automation to act on an incomplete view of the persisted task.
