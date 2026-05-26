# Pipeline onPlanResolved empty step status map announces unexecuted task as done

## Summary

`@poe-code/pipeline` accepts a task whose `status` is an empty step-status map (`{}`) and reports that task as completed through the exported `runPipeline()` progress callback before any execution selection occurs. A caller subscribing to `onPlanResolved` receives `{ done: 1, open: 0, total: 1 }` for a one-task plan whose task has never completed a step.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "./run/pipeline.js";

describe("pipeline empty step-status plan summary", () => {
  it("announces an unexecuted task as done through onPlanResolved", async () => {
    const volume = Volume.fromJSON({
      "/repo/docs/plans/plan.md": [
        "---", "kind: pipeline", "version: 1", "tasks:",
        "  - id: implement", "    title: Implement feature", "    prompt: Ship it", "    status: {}",
        "---", ""
      ].join("\n"),
      "/repo/.poe-code/pipeline/steps/default.yaml": "steps: {}\n"
    });
    const summary = vi.fn();
    await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      planDirectory: "docs/plans",
      fs: createFsFromVolume(volume).promises as never,
      runAgent: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      onPlanResolved: summary
    });

    console.log(JSON.stringify(summary.mock.calls[0]?.[0]));
    expect(summary).toHaveBeenCalledWith({
      planPath: "docs/plans/plan.md",
      done: 1,
      failed: 0,
      open: 0,
      total: 1
    });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
rm -f packages/pipeline/src/__probe__.test.ts
```

## Observed Behavior

The callback reports the unexecuted declared task as completed:

```text
{"planPath":"docs/plans/plan.md","done":1,"failed":0,"open":0,"total":1}
✓ packages/pipeline/src/__probe__.test.ts > pipeline empty step-status plan summary > announces an unexecuted task as done through onPlanResolved
```

`parseTaskStatus()` in `packages/pipeline/src/plan/parser.ts` accepts the empty step-status object unchanged. Before acquiring the pipeline lock or selecting any execution, `runPipeline()` calculates its public plan summary by passing each task status to `isTaskDone()` in `packages/pipeline/src/run/pipeline.ts`. That helper uses `Object.values(status).every(...)`, which evaluates to `true` for `{}`, so `onPlanResolved` is invoked with a false completed count independently of the later task-selection result path.

## Expected Behavior

`onPlanResolved` should report completion only from valid recorded task state. An empty per-step status map should be rejected as malformed or counted as incomplete/invalid, not announced to callback consumers as successfully completed work.

## Impact

SDK and CLI integrations that render initial pipeline progress, initialize telemetry, or decide whether work remains from `onPlanResolved` can immediately present a declared but never-executed task as done. This false pre-run completion signal is observable before the separate runner no-op result and can cause dashboards, logs, or orchestration decisions to claim completion for work that was never performed.
