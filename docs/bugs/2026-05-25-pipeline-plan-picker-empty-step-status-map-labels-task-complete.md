# Pipeline plan picker empty step status map labels task complete

## Summary

The exported `@poe-code/pipeline` plan-selection flow displays a plan containing a task with empty step-status map (`status: {}`) as fully completed. When discovery prompts the user to select that plan, its label is rendered as `docs/plans/plan.md (1/1)`, although no task step has ever executed.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { resolvePlanPaths } from "./plan/discovery.js";

describe("pipeline discovery empty status map", () => {
  it("does not advertise an unexecuted task as complete during selection", async () => {
    const volume = Volume.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: implement",
        "    title: Implement feature",
        "    prompt: Ship it",
        "    status: {}",
        "---",
        ""
      ].join("\n")
    });
    const fs = createFsFromVolume(volume).promises as never;
    const selectPlan = vi.fn(async ({ options }: { options: Array<{ label: string; value: string }> }) => options[0]!.value);

    await resolvePlanPaths({
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      fs,
      selectPlan
    });

    expect(selectPlan.mock.calls[0]?.[0].options[0]?.label).not.toContain("(1/1)");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm -f packages/pipeline/src/__probe__.test.ts
```

## Observed Behavior

The plan selection label claims all tasks are complete:

```text
FAIL  packages/pipeline/src/__probe__.test.ts > pipeline discovery empty status map > does not advertise an unexecuted task as complete during selection
AssertionError: expected 'docs/plans/plan.md (1/1)' not to contain '(1/1)'

Received: "docs/plans/plan.md (1/1)"
```

`countCompletedTasks()` in `packages/pipeline/src/plan/discovery.ts:33` counts object-valued task status with `Object.values(task.status).every((status) => status === "done")`. For `status: {}`, that empty-array predicate evaluates `true`, producing `{ done: 1, total: 1 }`. `resolvePlanPaths()` then embeds those numbers in the user-facing selection label at `packages/pipeline/src/plan/discovery.ts:179` through `packages/pipeline/src/plan/discovery.ts:209`.

## Expected Behavior

Interactive plan selection should display completion counts only from valid task status state. A task with an empty per-step status map should be rejected or counted as incomplete/invalid, not shown as one completed task out of one.

## Impact

Users selecting which pipelines to run may skip a plan because the prompt says it is complete even though its task was never executed. This can leave required implementation or validation work undone before a run even starts, independently of later runner or browser behavior.
