# Task-list YAML file proto metadata mutates returned task metadata prototype

## Summary

The YAML task-list backend permits arbitrary task metadata keys, but copies them into an ordinary `{}` metadata object using bracket assignment. A persisted YAML metadata key named `__proto__` is not returned as an own metadata property; it instead changes the prototype of the `Task.metadata` object and exposes inherited attacker-controlled values.

## Reproduction

From the repository root, run this disposable Vitest probe using the backend's in-memory filesystem test helper:

```sh
cat > packages/task-list/src/__probe__.test.ts <<'TEST'
import { describe, expect, it } from "vitest";
import { openTaskList } from "./open.js";
import { createFs } from "./backends/test-helpers.js";

describe("yaml task metadata __proto__", () => {
  it("does not preserve a YAML __proto__ metadata field as an own task metadata key", async () => {
    const { fs } = createFs({
      "/repo/tasks.yaml": [
        "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json",
        "kind: task-store",
        "version: 1",
        "lists:",
        "  planning:",
        "    proto:",
        "      name: Prototype task",
        "      state: draft",
        "      __proto__:",
        "        owner: attacker",
        ""
      ].join("\n")
    });
    const tasks = await openTaskList({ type: "yaml-file", path: "/repo/tasks.yaml", fs });

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
✓ packages/task-list/src/__probe__.test.ts > yaml task metadata __proto__ > does not preserve a YAML __proto__ metadata field as an own task metadata key
```

## Observed Behavior

`packages/task-list/src/backends/yaml-file.ts:101` through `packages/task-list/src/backends/yaml-file.ts:110` copy every non-reserved task field into `const metadata: Record<string, unknown> = {}` and assign each field with `metadata[key] = value`. For a YAML `__proto__` metadata key, that assignment changes the returned metadata object's prototype. `packages/task-list/src/backends/yaml-file.ts:113` through `packages/task-list/src/backends/yaml-file.ts:123` then expose the polluted object through the public `Task.metadata` result.

## Expected Behavior

The YAML backend should preserve permitted metadata keys as own data values or reject unsafe metadata names. Loading a task whose stored metadata includes `__proto__` must not alter the prototype of the returned metadata object.

## Impact

Opening a crafted task store can return metadata objects with inherited attacker-controlled properties. SDK and CLI code that treats `task.metadata` as a normal record may read values that are not explicit task fields, misrepresent task attributes, or apply downstream logic based on injected metadata.
