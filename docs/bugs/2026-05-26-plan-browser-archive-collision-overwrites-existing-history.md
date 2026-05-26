# Plan browser archive collision overwrites existing history

## Summary

The exported `plan-browser` `archivePlan()` helper archives a plan by renaming it to `archive/<same-basename>` without checking whether that destination already exists. On file systems where `rename()` replaces an existing destination, archiving a current plan silently overwrites a previously archived plan with the same filename, permanently losing archived history.

## Reproduction

Create the following disposable Vitest probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { archivePlan } from "./actions.js";
import type { ActionFs } from "./types.js";

function createMemFs(files: Record<string, string>): ActionFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ActionFs;
}

describe("archive plan filename collision", () => {
  it("silently overwrites an existing archived plan with the same basename", async () => {
    const fs = createMemFs({
      "/repo/docs/plans/review.md": "# Current\nnew work\n",
      "/repo/docs/plans/archive/review.md": "# Archived\nimportant history\n"
    });

    await archivePlan({ absolutePath: "/repo/docs/plans/review.md" }, fs);

    await expect(fs.readFile("/repo/docs/plans/archive/review.md", "utf8")).resolves.toBe("# Current\nnew work\n");
    await expect(fs.readFile("/repo/docs/plans/review.md", "utf8")).rejects.toThrow();
  });
});
```

Run it and remove the probe:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm -f packages/plan-browser/src/__probe__.test.ts
```

## Observed Behavior

The disposable probe passes:

```text
✓ packages/plan-browser/src/__probe__.test.ts > archive plan filename collision > silently overwrites an existing archived plan with the same basename
```

In the reproduction, `docs/plans/archive/review.md` begins with historical content, while the active `docs/plans/review.md` contains new work. After `archivePlan()` resolves, the active file is gone and the pre-existing archived file now contains the active plan content. `archiveSelectedPlan()` derives the archive destination solely from the active plan basename and directly executes `fs.rename(entry.absolutePath, archivedPath)` at `packages/plan-browser/src/actions.ts:34` through `packages/plan-browser/src/actions.ts:45`, without an existence check, unique archive naming, or no-clobber move behavior.

## Expected Behavior

Archiving a plan must preserve any already archived plan at the computed destination. If an archive entry with the same basename exists, the operation should reject with a clear conflict error or choose a non-colliding archive filename instead of overwriting prior content.

## Impact

Users archiving repeated versions of a plan with the same filename can silently destroy previously archived history. The action reports success while irreversibly replacing an older design, experiment, or execution record, undermining the archive as an audit and recovery mechanism.
