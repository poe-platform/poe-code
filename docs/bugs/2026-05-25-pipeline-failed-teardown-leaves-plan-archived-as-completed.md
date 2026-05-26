# Pipeline Failed Teardown Leaves Plan Archived as Completed

## Summary

`@poe-code/pipeline` archives a completed plan before executing its configured teardown. If teardown subsequently fails, `runPipeline()` returns `stopReason: "failed"`, but the active plan has already been removed and its archived copy records all tasks as done, making a failed finalization indistinguishable from a fully successful archived plan on disk.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { pipelineDocumentSchemaId } from "./plan/parser.js";
import { runPipeline } from "./run/pipeline.js";
import type { PipelineFileSystem } from "./types.js";

describe("pipeline teardown failure archive ordering", () => {
  it("archives the completed plan before a failing teardown returns failed", async () => {
    const planPath = "/repo/docs/plans/plan.md";
    const volume = Volume.fromJSON({
      [planPath]: [
        "---",
        `$schema: ${pipelineDocumentSchemaId}`,
        "kind: pipeline",
        "version: 1",
        "teardown:",
        "  mode: yolo",
        "  prompt: Clean up",
        "tasks:",
        "  - id: work",
        "    title: Work",
        "    prompt: Do work",
        "    status: open",
        "---",
        ""
      ].join("\n")
    }, "/");
    const fs = createFsFromVolume(volume).promises as unknown as PipelineFileSystem;
    let attempt = 0;

    const result = await runPipeline({
      agent: "codex",
      cwd: "/repo",
      homeDir: "/home/test",
      planDirectory: "docs/plans",
      plan: "docs/plans/plan.md",
      fs,
      runAgent: async () => {
        attempt += 1;
        return attempt === 1
          ? { stdout: "done", stderr: "", exitCode: 0 }
          : { stdout: "", stderr: "cleanup failed", exitCode: 1 };
      }
    });

    expect(result.stopReason).toBe("failed");
    await expect(fs.stat(planPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile("/repo/docs/plans/archive/plan.md", "utf8")).resolves.toContain("status: done");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/pipeline/src/__probe__.test.ts > pipeline teardown failure archive ordering > archives the completed plan before a failing teardown returns failed
```

## Observed Behavior

Once `selectNextExecution()` reports completion after at least one task run, `runPipeline()` releases its lock and calls `archivePlanShared()` at `packages/pipeline/src/run/pipeline.ts:418` through `packages/pipeline/src/run/pipeline.ts:427`. Only after that archive mutation does it execute `resolvedTeardown` at `packages/pipeline/src/run/pipeline.ts:428` through `packages/pipeline/src/run/pipeline.ts:445`. A nonzero teardown result returns `stopReason: "failed"`, but there is no unarchive or incomplete-finalization state. The reproduction confirms that the active plan path no longer exists and the archived copy contains `status: done` after teardown failure.

## Expected Behavior

Archival should occur only after teardown successfully finishes, or teardown failure should preserve/restore an active plan state that clearly remains actionable and failed. A pipeline that reports failed finalization must not be permanently stored in the successful archive location with only completed task state.

## Impact

Cleanup, validation, deployment rollback, or final verification failures can disappear into the archive as though the plan succeeded. Users and automation may not retry required teardown work, discovery no longer lists the failed plan among active work, and archived history becomes misleading for audit or release decisions.
