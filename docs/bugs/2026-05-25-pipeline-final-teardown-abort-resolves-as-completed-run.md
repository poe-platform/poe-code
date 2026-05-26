# Pipeline Final Teardown Abort Resolves as Completed Run

## Summary

`@poe-code/pipeline` does not re-check cancellation after a normally resolving teardown phase. If the final teardown agent aborts its supplied signal while returning exit code `0`, `runPipeline()` resolves with `stopReason: "completed"` even though the operation is already cancelled.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { pipelineDocumentSchemaId } from "./plan/parser.js";
import { runPipeline } from "./run/pipeline.js";
import type { PipelineFileSystem } from "./types.js";

describe("pipeline abort during successful teardown", () => {
  it("returns completed after teardown aborts the signal and resolves normally", async () => {
    const planPath = "/repo/docs/plans/plan.md";
    const volume = Volume.fromJSON({
      [planPath]: [
        "---", `$schema: ${pipelineDocumentSchemaId}`, "kind: pipeline", "version: 1",
        "teardown:", "  mode: yolo", "  prompt: Clean up", "tasks:",
        "  - id: work", "    title: Work", "    prompt: Do work", "    status: open", "---", ""
      ].join("\n")
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as PipelineFileSystem;
    const controller = new AbortController();
    const prompts: string[] = [];
    const runAgent = vi.fn(async (input: { prompt: string }) => {
      prompts.push(input.prompt);
      if (input.prompt === "Clean up") {
        controller.abort();
      }
      return { stdout: "done", stderr: "", exitCode: 0 };
    });

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      plan: "docs/plans/plan.md",
      fs,
      signal: controller.signal,
      runAgent
    });

    expect(prompts).toEqual(["Do work", "Clean up"]);
    expect(controller.signal.aborted).toBe(true);
    expect(result.stopReason).toBe("completed");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline abort during successful teardown > returns completed after teardown aborts the signal and resolves normally
```

## Observed Behavior

The shared `runPhase()` helper forwards `options.signal` to setup and teardown agent calls at `packages/pipeline/src/run/pipeline.ts:283` through `packages/pipeline/src/run/pipeline.ts:300`, but only marks a phase cancelled if `runAgent()` rejects with `AbortError` at `packages/pipeline/src/run/pipeline.ts:301` through `packages/pipeline/src/run/pipeline.ts:307`. After a teardown resolves with success, it emits successful phase completion and returns `{ success: true, cancelled: false }` at `packages/pipeline/src/run/pipeline.ts:309` through `packages/pipeline/src/run/pipeline.ts:319`. The completed-plan path then returns `stopReason: "completed"` at `packages/pipeline/src/run/pipeline.ts:428` through `packages/pipeline/src/run/pipeline.ts:455` without checking the now-aborted signal. The reproduction observes a completed result while `controller.signal.aborted` is true.

## Expected Behavior

Cancellation during the final active teardown phase should be checked after that phase resolves and surfaced as cancellation, or the API should explicitly define a successful teardown completion as taking precedence. The current behavior must not report uncomplicated completion for an operation whose supplied cancellation signal was triggered during its final agent execution.

## Impact

Callers and CLI controls can request cancellation during cleanup or final validation but receive a success status. This misstates cancellation telemetry, can cause automation to proceed with downstream success actions, and makes it impossible to distinguish a fully uninterrupted completed pipeline from one cancelled during teardown.
