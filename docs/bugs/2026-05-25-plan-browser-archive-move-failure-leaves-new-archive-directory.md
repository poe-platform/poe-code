# Plan Browser Archive Move Failure Leaves New Archive Directory

## Summary

The exported `archivePlan()` helper creates the destination `archive/` directory before moving the selected plan into it. If the subsequent rename fails, the operation rejects but leaves the newly created archive directory behind even though no plan was archived.

## Reproduction

Create the disposable probe `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { archivePlan } from "./actions.js";
import type { ActionFs } from "./types.js";

describe("archivePlan rename failure", () => {
  it("leaves a newly created archive directory after the move rejects", async () => {
    const volume = Volume.fromJSON({ "/repo/docs/plans/feature.md": "# Feature\n" }, "/");
    const raw = createFsFromVolume(volume).promises;
    const fs: ActionFs = {
      mkdir: raw.mkdir.bind(raw) as ActionFs["mkdir"],
      unlink: raw.unlink.bind(raw) as ActionFs["unlink"],
      readFile: raw.readFile.bind(raw) as ActionFs["readFile"],
      async rename() { throw new Error("cross-device move failed"); }
    };

    await expect(archivePlan({ absolutePath: "/repo/docs/plans/feature.md" }, fs))
      .rejects.toThrowError("cross-device move failed");
    await expect(raw.stat("/repo/docs/plans/archive")).resolves.toBeDefined();
    await expect(raw.readFile("/repo/docs/plans/feature.md", "utf8")).resolves.toBe("# Feature\n");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that archive-directory creation persists after the plan move fails. Remove the disposable probe after running it.

## Observed Behavior

When the selected plan exists but `fs.rename()` rejects with `cross-device move failed`, `archivePlan()` rejects and the active plan remains at its original location, yet `/repo/docs/plans/archive` now exists. `archiveSelectedPlan()` calculates the directory, awaits `fs.mkdir(archiveDir, { recursive: true })`, and only then awaits `fs.rename(entry.absolutePath, archivedPath)` at `packages/plan-browser/src/actions.ts:34` through `packages/plan-browser/src/actions.ts:45`, without removing a newly created empty directory after a failed move.

## Expected Behavior

If archiving cannot move the selected plan, the helper should avoid creating new durable archive state or clean up a directory it created solely for the failed operation. A rejected archive attempt should leave the plan directory unchanged when no archival result exists.

## Impact

Cross-device rename failures, permissions problems, or filesystem adapter errors can make a failed archive attempt mutate project structure. The unexpected empty archive directory can mislead users or automation into believing archival was initialized or partially successful and can accumulate stale state after repeated failures.
