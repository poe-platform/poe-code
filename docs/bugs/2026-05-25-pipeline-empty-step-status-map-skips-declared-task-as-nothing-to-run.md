# Pipeline empty step status map skips declared task as nothing to run

## Summary

`@poe-code/pipeline` accepts a task whose `status` is an empty step-status map (`{}`) and treats that task as already completed. A plan containing a declared task with work to perform therefore invokes no task agent and returns `stopReason: "nothing_to_run"`, even though the task has never recorded any completed step.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "./run/pipeline.js";

describe("pipeline empty step-status map", () => {
  it("skips a declared task and reports nothing to run", async () => {
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
      ].join("\n"),
      "/repo/.poe-code/pipeline/steps/default.yaml": "steps: {}\n"
    });
    const fs = createFsFromVolume(volume).promises as never;
    const runAgent = vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0 }));

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      planDirectory: "docs/plans",
      fs,
      runAgent
    });

    console.log(JSON.stringify({ stopReason: result.stopReason, calls: runAgent.mock.calls.length }));
    expect(result.stopReason).toBe("nothing_to_run");
    expect(runAgent).not.toHaveBeenCalled();
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm -f packages/pipeline/src/__probe__.test.ts
```

## Observed Behavior

The task is silently skipped and the pipeline reports that no work exists:

```text
{"stopReason":"nothing_to_run","calls":0}
✓ packages/pipeline/src/__probe__.test.ts > pipeline empty step-status map > skips a declared task and reports nothing to run
```

`parseTaskStatus()` in `packages/pipeline/src/plan/parser.ts:278` accepts any record as a step-status map and returns an empty object unchanged when the plan writes `status: {}`. `selectFromTask()` in `packages/pipeline/src/run/runner.ts:10` looks for any step value not equal to `"done"`; for an empty object it finds none and immediately returns `{ kind: "completed" }`. `runPipeline()` consequently reaches its completed-selection path before executing the task and returns `"nothing_to_run"` when no prior runs were made.

## Expected Behavior

A task-level step-status map must contain at least one executable step status, or an empty map must be rejected as malformed plan state. A declared task with no recorded completed work must not be treated as complete and skipped without executing its prompt.

## Impact

Malformed or partially generated pipeline plans can silently omit required task work while returning an apparently normal no-op result. Automation may treat a feature, migration, test pass, or cleanup task as already satisfied even though no agent executed it and no task completion was ever recorded.
