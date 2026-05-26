# Poe Code Config Job Atomic Write Temp Cleanup Failure Masks Rename Error

## Summary

The exported runtime job registry writes each job through a temporary file followed by `rename()`, but its failure cleanup can replace the original atomic-commit error. If the rename fails and deleting the temporary file also fails, `put()` or `update()` rejects with the cleanup error instead of the rename failure that actually prevented persistence.

## Reproduction

Create a disposable Vitest probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createJobRegistry, type JobEntry, type StateFileSystem } from "./state/jobs.js";

describe("job atomic write cleanup masking", () => {
  it("throws cleanup failure instead of the rename failure that prevented persistence", async () => {
    const base = createFsFromVolume(new Volume()).promises as unknown as StateFileSystem;
    const fs: StateFileSystem = {
      ...base,
      async rename() {
        throw new Error("rename offline");
      },
      async unlink(filePath) {
        if (filePath.includes(".tmp")) throw new Error("temp cleanup denied");
        await base.unlink(filePath);
      },
    };
    const registry = createJobRegistry("/home/tester", fs);
    const job: JobEntry = {
      id: "job-1",
      env_id: "env-job-1",
      env_kind: "docker",
      tool: "npm",
      argv: ["run", "test"],
      cwd: "/repo",
      started_at: "2026-05-25T00:00:00.000Z",
      status: "pending",
    };

    const error = await registry.put(job).catch((cause: unknown) => cause as Error);
    console.log(JSON.stringify({ name: error.name, message: error.message }));
    expect(error.message).toBe("temp cleanup denied");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"name":"Error","message":"temp cleanup denied"}
✓ packages/poe-code-config/src/__probe__.test.ts > job atomic write cleanup masking > throws cleanup failure instead of the rename failure that prevented persistence
```

Remove the disposable probe after validation.

## Observed Behavior

`writeJobAtomically()` creates and writes a temporary job file, then attempts to rename it into place at `packages/poe-code-config/src/state/jobs.ts:151`. Its `catch` block awaits `removeTempFile(tempPath)` before rethrowing the captured commit error at `packages/poe-code-config/src/state/jobs.ts:162`. `removeTempFile()` rethrows any cleanup error except `ENOENT` at `packages/poe-code-config/src/state/jobs.ts:168`. In the probe, `rename()` fails with `"rename offline"`, but the caller receives only `"temp cleanup denied"`.

## Expected Behavior

Failure to clean an abandoned temporary file should not overwrite the primary job persistence failure. The API should preserve the rename/write error as the reported cause and, if useful, attach the cleanup failure as secondary diagnostic information.

## Impact

When runtime state storage fails during an atomic commit and its best-effort cleanup is also blocked, users and automated recovery logic receive the wrong failure reason. This conceals whether a job update reached its durable target, makes filesystem/storage diagnosis unreliable, and leaves an orphan temporary file without accurately reporting the failed commit operation that created it.
