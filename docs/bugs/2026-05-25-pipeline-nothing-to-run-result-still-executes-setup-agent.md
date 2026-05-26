# Pipeline `nothing_to_run` Result Still Executes Setup Agent

## Summary

`@poe-code/pipeline` executes a configured setup agent before it determines whether any task needs work. A plan whose tasks are already complete can launch setup side effects and increment completed-step metrics, then return `stopReason: "nothing_to_run"`, falsely implying that no execution occurred.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { pipelineDocumentSchemaId } from "./plan/parser.js";
import { runPipeline } from "./run/pipeline.js";
import type { PipelineFileSystem } from "./types.js";

describe("pipeline setup on completed plan", () => {
  it("runs setup even though the result says nothing_to_run", async () => {
    const planPath = "/repo/docs/plans/plan.md";
    const volume = Volume.fromJSON({
      [planPath]: [
        "---", `$schema: ${pipelineDocumentSchemaId}`, "kind: pipeline", "version: 1",
        "setup:", "  mode: yolo", "  prompt: Prepare workspace", "tasks:",
        "  - id: done", "    title: Done", "    prompt: Nothing", "    status: done", "---", ""
      ].join("\n")
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as PipelineFileSystem;
    const prompts: string[] = [];

    const result = await runPipeline({
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

    expect(result.stopReason).toBe("nothing_to_run");
    expect(prompts).toEqual(["Prepare workspace"]);
    expect(result.metrics.stepsCompleted).toBe(1);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline setup on completed plan > runs setup even though the result says nothing_to_run
```

## Observed Behavior

`runPipeline()` resolves and executes setup at `packages/pipeline/src/run/pipeline.ts:321` through `packages/pipeline/src/run/pipeline.ts:359` before selecting the next task under lock. It only determines that all tasks are already complete inside the loop at `packages/pipeline/src/run/pipeline.ts:414` through `packages/pipeline/src/run/pipeline.ts:455`, where it returns `"nothing_to_run"` when `runsCompleted === 0`. In the reproduction, `runAgent()` receives `"Prepare workspace"`, `metrics.stepsCompleted` is `1`, and the public result still claims `nothing_to_run`.

## Expected Behavior

A `nothing_to_run` result should mean the pipeline did not invoke setup, tasks, or teardown because no execution was needed. The runner should determine whether actionable tasks exist before launching setup, or return a status that truthfully indicates setup was performed.

## Impact

Polling, status checks, and no-op CI invocations can execute arbitrary setup agents despite receiving a no-work result. Such setup may modify repositories, start services, install dependencies, spend agent resources, or trigger external actions while callers incorrectly treat the run as side-effect-free.
