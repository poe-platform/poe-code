# Agent Harness workflow lock release rejects after completed iteration event

## Summary

The public `@poe-code/agent-harness-tools` `runDocumentWorkflow()` API invokes `onIterationEnd(iteration, "completed")` after successful stage execution, then awaits its workflow-lock release callback in a nested `finally` block. If lock release rejects, the API rejects after callers have already observed a completed iteration event.

## Reproduction

1. Add this disposable probe as `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runDocumentWorkflow, type WorkflowFileSystem } from "./runner.js";

const mocked = vi.hoisted(() => ({
  releaseLock: vi.fn(async () => {
    throw new Error("workflow lock release denied");
  })
}));

vi.mock("./lock.js", () => ({
  lockWorkflow: vi.fn(async () => mocked.releaseLock)
}));

describe("document workflow lock release probe", () => {
  it("rejects after already emitting a completed iteration", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/repo/workflow.md": "workflow" }, "/"))
      .promises as unknown as WorkflowFileSystem;
    const onIterationEnd = vi.fn();

    await expect(
      runDocumentWorkflow({
        cwd: "/repo",
        homeDir: "/home/test",
        docPath: "/repo/workflow.md",
        fs,
        readConfig: async () => ({
          frontmatter: {
            participants: { default: { agent: "codex", mode: "edit" } },
            stages: [{ id: "build", participant: "default", prompt: "Build" }],
            max_iterations: 1
          },
          body: ""
        }),
        runAgent: async () => ({ exitCode: 0 }),
        onIterationEnd
      })
    ).rejects.toThrow("workflow lock release denied");

    expect(onIterationEnd).toHaveBeenCalledWith(0, "completed");
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/agent-harness-tools/src/__probe__.test.ts > document workflow lock release probe > rejects after already emitting a completed iteration
```

## Observed Behavior

The only workflow stage completes successfully and `runDocumentWorkflow()` calls `onIterationEnd(0, "completed")`. The subsequent lock-release callback rejects with `workflow lock release denied`, causing the exported operation to reject even though consumers have already been notified that the iteration completed.

## Expected Behavior

Workflow iteration completion should not be publicly announced before mandatory lock cleanup can turn the containing run into a rejection, unless the API explicitly exposes separate cleanup failure semantics. Lock-release failure should be surfaced without contradicting an already emitted completed iteration outcome.

## Impact

Consumers may record completed iteration progress, trigger dependent actions, or update dashboards before receiving a rejected workflow promise for the same run. A transient lock cleanup error therefore produces contradictory orchestration signals and can prompt redundant retries after successful agent work was already announced.
