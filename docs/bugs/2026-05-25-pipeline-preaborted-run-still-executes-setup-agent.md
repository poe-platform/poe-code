# Pipeline Pre-Aborted Run Still Executes Setup Agent

## Summary

`@poe-code/pipeline` fails to check an already-aborted signal before invoking its setup agent. A pipeline run cancelled before it starts can still execute configured setup work and only reject with `AbortError` afterward, when it reaches the task-loop cancellation check.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { pipelineDocumentSchemaId } from "./plan/parser.js";
import { runPipeline } from "./run/pipeline.js";
import type { PipelineFileSystem } from "./types.js";

describe("pipeline pre-aborted setup", () => {
  it("executes setup before rejecting an already aborted run", async () => {
    const planPath = "/repo/docs/plans/plan.md";
    const volume = Volume.fromJSON({
      [planPath]: [
        "---", `$schema: ${pipelineDocumentSchemaId}`, "kind: pipeline", "version: 1",
        "setup:", "  mode: yolo", "  prompt: Prepare workspace", "tasks:",
        "  - id: work", "    title: Work", "    prompt: Do work", "    status: open", "---", ""
      ].join("\n")
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as PipelineFileSystem;
    const controller = new AbortController();
    controller.abort();
    const prompts: string[] = [];

    await expect(runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      plan: "docs/plans/plan.md",
      fs,
      signal: controller.signal,
      runAgent: vi.fn(async (input) => {
        prompts.push(input.prompt);
        return { stdout: "", stderr: "", exitCode: 0 };
      })
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(prompts).toEqual(["Prepare workspace"]);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline pre-aborted setup > executes setup before rejecting an already aborted run
```

## Observed Behavior

After parsing initial setup configuration, `runPipeline()` immediately invokes `runPhase(resolvedSetup, "setup", ...)` at `packages/pipeline/src/run/pipeline.ts:321` through `packages/pipeline/src/run/pipeline.ts:359`, forwarding the already-aborted signal into the agent input but not checking it itself. The first explicit `assertNotAborted(options.signal)` does not occur until the task-processing loop begins at `packages/pipeline/src/run/pipeline.ts:361` through `packages/pipeline/src/run/pipeline.ts:364`. In the reproduction, an already-aborted run still calls the setup agent once, then rejects only after setup resolves.

## Expected Behavior

When `options.signal` is already aborted before `runPipeline()` begins executing phases, the pipeline should reject or return cancellation before invoking any setup or task agent. Pre-cancellation should suppress all new execution side effects.

## Impact

Schedulers, CLI interrupts, and callers attempting to cancel before launch can still trigger setup mutations, external actions, and agent spending. The API reports cancellation only after unwanted work has occurred, violating expectations that a pre-aborted run is inert.
