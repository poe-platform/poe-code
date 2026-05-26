# Task-list Markdown directory proto frontmatter mutates returned task metadata prototype

## Summary

The Markdown-directory task backend supports arbitrary non-reserved frontmatter as task metadata, but copies those entries into an ordinary object through bracket assignment. Frontmatter containing `__proto__` changes the prototype of the public `Task.metadata` object instead of returning that key as normal persisted metadata.

## Reproduction

From the repository root, run this disposable Vitest probe using an in-memory Markdown task directory:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'TEST'
import { describe, expect, it } from "vitest";
import { openTaskList } from "./open.js";
import { createFs } from "./backends/test-helpers.js";

describe("markdown task metadata __proto__", () => {
  it("does not preserve frontmatter __proto__ metadata as an own task metadata key", async () => {
    const { fs } = createFs({
      "/repo/tasks/planning/proto.md": [
        "---",
        "name: Prototype task",
        "state: draft",
        "__proto__:",
        "  owner: attacker",
        "---",
        "",
        "Body"
      ].join("\n")
    });
    const tasks = await openTaskList({ type: "markdown-dir", path: "/repo/tasks", fs });

    const task = await tasks.list("planning").get("proto");
    console.log(JSON.stringify({ ownsProto: Object.hasOwn(task.metadata, "__proto__"), inheritedOwner: (task.metadata as { owner?: string }).owner }));

    expect(Object.hasOwn(task.metadata, "__proto__")).toBe(false);
    expect((task.metadata as { owner?: string }).owner).toBe("attacker");
  });
});
TEST
npx vitest run packages/task-list/src/__probe__.test.ts --reporter=verbose
rm packages/task-list/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"ownsProto":false,"inheritedOwner":"attacker"}
✓ packages/task-list/src/__probe__.test.ts > markdown task metadata __proto__ > does not preserve frontmatter __proto__ metadata as an own task metadata key
```

## Observed Behavior

`packages/task-list/src/backends/markdown-dir.ts:276` through `packages/task-list/src/backends/markdown-dir.ts:289` create `metadata` as `{}` and copy every non-reserved frontmatter key using `metadata[key] = value`. A parsed `__proto__` key therefore mutates the returned object's prototype. `packages/task-list/src/backends/markdown-dir.ts:295` through `packages/task-list/src/backends/markdown-dir.ts:307` expose this polluted object through the task returned by public backend reads.

## Expected Behavior

Permitted Markdown frontmatter metadata should be returned as own values or unsafe keys should be rejected. Reading a task document with a `__proto__` field must not alter the prototype of its public metadata object.

## Impact

A crafted task Markdown file can cause normal task reads to expose inherited attacker-controlled metadata. Consumers that inspect arbitrary metadata fields may treat injected inherited values as real task attributes, affecting display, filtering, automation, or task-processing logic.
