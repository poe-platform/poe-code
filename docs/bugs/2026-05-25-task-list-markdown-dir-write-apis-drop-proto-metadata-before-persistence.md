# Task-list Markdown directory write APIs drop proto metadata before persistence

## Summary

The public Markdown-directory task APIs accept arbitrary non-reserved metadata for task creation, updates, and transition metadata patches. When callers supply an enumerable own metadata field named `__proto__`, all three write paths assign that key into an ordinary frontmatter object and silently lose it before serializing the Markdown document.

## Reproduction

From the repository root, run this disposable Vitest probe using the backend's in-memory filesystem helper:

```sh
cat > packages/task-list/src/backends/__probe__.test.ts <<'TEST'
import { describe, expect, it } from "vitest";
import { openTaskList } from "../open.js";
import { createFs } from "./test-helpers.js";

function ownProtoMetadata(): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  Object.defineProperty(metadata, "__proto__", {
    value: { reviewer: "security" },
    enumerable: true,
    writable: true,
    configurable: true
  });
  return metadata;
}

describe("markdown-dir write metadata", () => {
  it("drops __proto__ through create, update, and fire metadataPatch", async () => {
    const { fs, rawFs } = createFs();
    const taskList = await openTaskList({
      type: "markdown-dir",
      path: "/repo/tasks",
      create: true,
      fs
    });
    const tasks = taskList.list("planning");

    const created = await tasks.create({ id: "create", name: "Create", metadata: ownProtoMetadata() });
    await tasks.create({ id: "update", name: "Update" });
    const updated = await tasks.update("update", { metadata: ownProtoMetadata() });
    await tasks.create({ id: "fire", name: "Fire" });
    const fired = await tasks.fire("fire", "plan", { metadataPatch: ownProtoMetadata() });

    for (const task of [created, updated, fired]) {
      const stored = await rawFs.readFile(task.sourcePath ?? "", "utf8");
      expect(Object.hasOwn(task.metadata, "__proto__")).toBe(false);
      expect(task.metadata.reviewer).toBeUndefined();
      expect(stored).not.toContain("reviewer");
    }
  });
});
TEST
npm exec -- vitest run packages/task-list/src/backends/__probe__.test.ts --reporter verbose
rm packages/task-list/src/backends/__probe__.test.ts
```

The probe passes:

```text
✓ packages/task-list/src/backends/__probe__.test.ts > markdown-dir write metadata > drops __proto__ through create, update, and fire metadataPatch
```

For example, after the `create()` case the serialized file contains the standard task envelope but no submitted metadata value:

```text
---
$schema: https://poe-platform.github.io/poe-code/schemas/task-list/task.schema.json
kind: task
version: 1
name: Create
state: draft
created: 2026-05-25T10:00:55.784Z
---
```

## Observed Behavior

`packages/task-list/src/backends/markdown-dir.ts:447` through `packages/task-list/src/backends/markdown-dir.ts:475`, `packages/task-list/src/backends/markdown-dir.ts:478` through `packages/task-list/src/backends/markdown-dir.ts:510`, and `packages/task-list/src/backends/markdown-dir.ts:532` through `packages/task-list/src/backends/markdown-dir.ts:548` build ordinary frontmatter objects and copy caller-controlled metadata with `frontmatter[key] = value` or `nextFrontmatter[key] = value`. For an enumerable own `__proto__` property, that assignment changes the temporary object's prototype rather than creating serializable own frontmatter. The public `create()`, `update()`, and `fire()` implementations then serialize and return those affected frontmatter objects at `packages/task-list/src/backends/markdown-dir.ts:887` through `packages/task-list/src/backends/markdown-dir.ts:985`, so the requested metadata is absent both from the returned task and from the stored Markdown file.

## Expected Behavior

All metadata fields accepted by the Markdown-directory write APIs should either be persisted as own frontmatter values or be explicitly rejected. A permitted caller-supplied `__proto__` field must not silently disappear while creating, updating, or firing a task.

## Impact

Clients that treat task metadata writes as durable can lose caller-provided values without an error. This affects task creation, ordinary metadata updates, and transition-time metadata patches, producing stored documents and returned tasks that do not reflect the submitted metadata while making audits or automation based on that field unreliable.
