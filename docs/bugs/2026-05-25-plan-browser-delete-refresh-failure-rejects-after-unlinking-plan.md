# Plan Browser Delete Refresh Failure Rejects After Unlinking Plan

## Summary

The `@poe-code/plan-browser` explorer delete action permanently unlinks the selected plan file before refreshing the browser view. If refresh fails after deletion, the action rejects without acknowledging that the plan has already been irreversibly removed.

## Reproduction

Create the disposable probe `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildPlanExplorerConfig } from "./explorer-config.js";
import type { PlanEntry } from "./types.js";

const plan: PlanEntry = {
  path: "feature.md", absolutePath: "/repo/docs/plans/feature.md", kind: "plan",
  typeLabel: "Plan", detail: "Feature", modifiedAt: 1
};

describe("plan delete action refresh failure", () => {
  it("rejects after deleting the file when dashboard refresh fails", async () => {
    const unlink = vi.fn().mockResolvedValue(undefined);
    const config = buildPlanExplorerConfig({
      plans: [plan], variables: {},
      fs: { mkdir: vi.fn(), rename: vi.fn(), unlink, readFile: vi.fn(), readdir: vi.fn(), stat: vi.fn() } as never,
      onRefresh: vi.fn().mockRejectedValue(new Error("refresh unavailable"))
    });
    const action = config.actions!.find((candidate) => candidate.id === "delete")!;

    await expect(action.handler({ row: { id: plan.absolutePath } as never, refresh: config.refresh!, toast: vi.fn() } as never))
      .rejects.toThrowError("refresh unavailable");
    expect(unlink).toHaveBeenCalledWith("/repo/docs/plans/feature.md");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that unlink completes before the action surfaces a later refresh failure. Remove the disposable probe after running it.

## Observed Behavior

The delete action awaits `deletePlan(entry, options.fs)` at `packages/plan-browser/src/explorer-config.ts:61` through `packages/plan-browser/src/explorer-config.ts:71`, then awaits `ctx.refresh()` before displaying its deletion toast. `deletePlan()` performs `fs.unlink(entry.absolutePath)` at `packages/plan-browser/src/actions.ts:47` through `packages/plan-browser/src/actions.ts:52`. In the probe, `unlink("/repo/docs/plans/feature.md")` resolves successfully, but the refresh rejection makes the action handler reject without indicating that the file is already gone.

## Expected Behavior

After permanent deletion succeeds, a later refresh failure should not be reported as though the delete operation did not commit. The action should preserve/report deletion success and separately state that the updated browser view could not be loaded.

## Impact

Transient refresh failures can hide an irreversible deletion behind failure behavior. Users may retry, search for a plan that has already been removed, or assume their document remains available when it no longer exists, making recovery and incident diagnosis substantially harder than for a mere display error.
