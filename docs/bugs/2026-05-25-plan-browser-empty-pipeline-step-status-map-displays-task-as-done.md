# Plan browser empty pipeline step status map displays task as done

## Summary

`@poe-code/plan-browser` presents a pipeline task whose `status` value is an empty step-status map (`{}`) as completed progress. Loading metadata for a plan with one such unexecuted task produces `detail: "1/1 done"`, even though the plan has not recorded any successful step or task execution.

## Reproduction

Create a disposable Vitest probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readPlanMetadata } from "./format.js";

describe("plan-browser empty pipeline step status", () => {
  it("does not present an unexecuted empty-status task as complete", async () => {
    const metadata = await readPlanMetadata({
      kind: "pipeline",
      absolutePath: "/repo/docs/plans/plan.md",
      path: "docs/plans/plan.md",
      fs: { readFile: async () => [
        "---",
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: implement",
        "    title: Implement feature",
        "    prompt: Ship it",
        "    status: {}",
        "---",
        "# Feature"
      ].join("\n") }
    });

    expect(metadata.detail).not.toBe("1/1 done");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm -f packages/plan-browser/src/__probe__.test.ts
```

## Observed Behavior

The metadata reader displays the unexecuted task as fully complete:

```text
FAIL  packages/plan-browser/src/__probe__.test.ts > plan-browser empty pipeline step status > does not present an unexecuted empty-status task as complete
AssertionError: expected '1/1 done' not to be '1/1 done' // Object.is equality
```

`formatPipelineProgress()` in `packages/plan-browser/src/format.ts:22` parses the plan and counts tasks accepted by `isPipelineTaskDone()`. For an object status, `isPipelineTaskDone()` at line 13 returns `Object.values(task.status).every((status) => status === "done")`. The empty map yields an empty array whose `every(...)` result is `true`, so the malformed task is counted as completed and emitted as `"1/1 done"` by the metadata path.

## Expected Behavior

Pipeline progress display should count a task as completed only when it contains valid recorded completion state. An empty per-step status map should be rejected as malformed or displayed as incomplete/invalid rather than as a successfully done task.

## Impact

Users browsing partially generated or corrupted pipeline plans can be told that required work is fully complete when no step has executed. This false completion signal can cause plans to be ignored, archived, or deprioritized while implementation, testing, or review tasks remain undone.
