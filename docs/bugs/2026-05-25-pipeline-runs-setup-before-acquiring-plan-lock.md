# Pipeline Runs Setup Before Acquiring Plan Lock

## Summary

`@poe-code/pipeline` runs its configured setup agent before it acquires the execution lock for the plan document. A second pipeline invocation can therefore perform setup side effects concurrently while another live invocation still owns the same plan lock, defeating the lock's serialization guarantee before task execution begins.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { lockWorkflow } from "@poe-code/agent-harness-tools";
import { pipelineDocumentSchemaId } from "./plan/parser.js";
import { runPipeline } from "./run/pipeline.js";
import type { PipelineFileSystem } from "./types.js";

describe("pipeline setup lock ordering", () => {
  it("runs setup while another pipeline execution still owns the plan lock", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const planPath = "/repo/docs/plans/plan.md";
    const volume = Volume.fromJSON({
      [planPath]: [
        "---", `$schema: ${pipelineDocumentSchemaId}`, "kind: pipeline", "version: 1",
        "setup:", "  mode: yolo", "  prompt: Prepare workspace", "tasks:",
        "  - id: work", "    title: Work", "    prompt: Do work", "    status: open", "---", ""
      ].join("\n")
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as PipelineFileSystem;
    const release = await lockWorkflow(planPath, {
      fs: fs as Parameters<typeof lockWorkflow>[1]["fs"],
      minTimeout: 10,
      maxTimeout: 10,
      retries: Number.POSITIVE_INFINITY
    });
    const prompts: string[] = [];

    const pending = runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      fs,
      runAgent: vi.fn(async (input) => {
        prompts.push(input.prompt);
        return { stdout: "", stderr: "", exitCode: 0 };
      })
    });

    await vi.waitFor(() => expect(prompts).toEqual(["Prepare workspace"]));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(prompts).toEqual(["Prepare workspace"]);

    await release();
    await vi.advanceTimersByTimeAsync(250);
    await pending;
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline setup lock ordering > runs setup while another pipeline execution still owns the plan lock
```

## Observed Behavior

`runPipeline()` loads its initial document and invokes `runPhase(resolvedSetup, "setup", ...)` at `packages/pipeline/src/run/pipeline.ts:321` through `packages/pipeline/src/run/pipeline.ts:359`. It does not call `acquirePipelineLock()` until the subsequent processing loop at `packages/pipeline/src/run/pipeline.ts:361` through `packages/pipeline/src/run/pipeline.ts:370`. In the reproduction, a separately acquired live lock remains held on the plan, yet `runAgent()` has already received the setup prompt; only the normal task phase remains blocked until the lock is released.

## Expected Behavior

Setup execution that is part of a pipeline run should be protected by the same plan-level exclusivity as task execution and finalization. A run blocked behind another live owner should not invoke setup agents or mutate shared workspace state before it obtains the plan lock.

## Impact

Concurrent invocations of the same pipeline can both initialize environments, install dependencies, alter repositories, start external jobs, or consume agent resources even though only one holds the lock. Side effects intended to happen once per serialized run can overlap, conflict, or occur for a queued run that never subsequently executes a task.
