# Pipeline status failed write corrupts prior plan document

## Summary

`@poe-code/pipeline`'s exported `writeTaskStatus()` helper rewrites the active YAML or Markdown plan document directly at its live path when persisting task progress. If the filesystem modifies the file partially and then rejects the write, `writeTaskStatus()` reports failure only after destroying the previously valid plan content. Unlike a staged replacement, the failed status update leaves no intact plan for retry or inspection.

## Reproduction

Create a disposable Vitest probe at `packages/pipeline/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { writeTaskStatus } from "./plan/writer.js";

describe("pipeline status failed write probe", () => {
  it("corrupts the prior plan before rejecting a status update", async () => {
    const initial = "tasks:\n  - id: task-1\n    title: One\n    prompt: First\n    status: open\n";
    const volume = Volume.fromJSON({ "/repo/plan.yaml": initial }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      readFile: rawFs.readFile.bind(rawFs),
      writeFile: async (filePath: string) => {
        await rawFs.writeFile(filePath, "tasks: [", "utf8");
        throw new Error("simulated partial write failure");
      }
    };

    await expect(
      writeTaskStatus({ fs, planPath: "/repo/plan.yaml", taskId: "task-1", status: "done" })
    ).rejects.toThrow("simulated partial write failure");
    await expect(rawFs.readFile("/repo/plan.yaml", "utf8")).resolves.toBe("tasks: [");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/pipeline/src/__probe__.test.ts` afterward.

## Observed Behavior

- The initial plan is valid YAML containing task `task-1` with status `open`.
- The injected `writeFile()` simulates a partial filesystem write by replacing the plan with `tasks: [` and then throwing.
- `writeTaskStatus(... status: "done")` rejects with `simulated partial write failure`.
- Reading `/repo/plan.yaml` after rejection returns only the malformed fragment `tasks: [`, proving the prior valid plan was corrupted despite the operation reporting failure.
- In `packages/pipeline/src/plan/writer.ts`, `writeTaskStatus()` reads and transforms the document, then directly invokes `options.fs.writeFile(options.planPath, ...)` with no temporary sibling, atomic rename, or rollback path.

## Expected Behavior

Persisting task status should preserve the last valid pipeline plan when the replacement cannot be committed successfully. A failed update should leave the prior document usable, typically by staging the transformed document and atomically replacing the live plan only after a complete write.

## Impact

Transient disk-full, interrupted filesystem, or injected write failures during normal pipeline execution can corrupt the source plan itself. Future pipeline runs, status dashboards, and manual inspection may fail to parse the workflow, converting one failed progress update into loss of the runnable plan state.
