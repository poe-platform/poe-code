# Pipeline Final Task Abort Writes Done State Then Rejects Cancellation

## Summary

`@poe-code/pipeline` can persist a final task as successfully completed and then reject the overall run with `AbortError`. If the final task runner aborts the supplied signal while resolving normally with exit code `0`, the pipeline records `status: done`, counts completion, and only notices cancellation when it starts the next loop cycle instead of returning a coherent completed or cancelled result.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "./run/pipeline.js";
import { pipelineDocumentSchemaId } from "./plan/parser.js";
import type { PipelineFileSystem } from "./types.js";

describe("pipeline abort during final successful task", () => {
  it("rejects after writing final success when the agent aborts and resolves normally", async () => {
    const planPath = "/repo/docs/plans/plan.md";
    const volume = Volume.fromJSON({
      [planPath]: [
        "---",
        `$schema: ${pipelineDocumentSchemaId}`,
        "kind: pipeline",
        "version: 1",
        "tasks:",
        "  - id: final",
        "    title: Final task",
        "    prompt: Finish work",
        "    status: open",
        "---",
        ""
      ].join("\n")
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as PipelineFileSystem;
    const controller = new AbortController();

    await expect(runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      fs,
      signal: controller.signal,
      runAgent: vi.fn(async () => {
        controller.abort();
        return { stdout: "done", stderr: "", exitCode: 0 };
      })
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(controller.signal.aborted).toBe(true);
    await expect(fs.readFile(planPath, "utf8")).resolves.toContain("status: done");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline abort during final successful task > rejects after writing final success when the agent aborts and resolves normally
```

## Observed Behavior

`runPipeline()` forwards `options.signal` to task execution in `packages/pipeline/src/run/pipeline.ts:494` through `packages/pipeline/src/run/pipeline.ts:505`, but it only treats cancellation specially when `runAgent()` throws an `AbortError` at `packages/pipeline/src/run/pipeline.ts:507` through `packages/pipeline/src/run/pipeline.ts:521`. When the agent resolves normally after aborting the signal, the pipeline computes success, writes `"done"` status, increments its completion counters, and emits completion at `packages/pipeline/src/run/pipeline.ts:524` through `packages/pipeline/src/run/pipeline.ts:568`. The next loop iteration executes `assertNotAborted(options.signal)` at `packages/pipeline/src/run/pipeline.ts:362`, so the exported promise rejects instead of reaching the completed-plan result path. The reproduction observes a rejected `AbortError` together with persisted final `status: done`.

## Expected Behavior

After an active task returns, the pipeline should consistently arbitrate cancellation before persisting or announcing final success, or intentionally treat successful final completion as authoritative and return the matching completed result. It should not leave durable completed state while exposing the same operation as an uncaught cancellation failure.

## Impact

Callers can retry, alert on, or mark failed a pipeline whose final work was already persisted as done. Automation sees a rejected/cancelled execution while the plan is complete on disk, leading to conflicting dashboards, misleading CI status, skipped teardown or archive behavior, and unsafe duplicate follow-up actions.
