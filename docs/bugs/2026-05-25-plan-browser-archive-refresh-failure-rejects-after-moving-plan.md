# Plan Browser Archive Refresh Failure Rejects After Moving Plan

## Summary

The `@poe-code/plan-browser` explorer archive action moves the selected plan into the archive directory before refreshing the browser view. If refresh fails after that move, the action rejects without its success toast even though the destructive archive operation has already committed.

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

describe("plan archive action refresh failure", () => {
  it("rejects after archiving the file when dashboard refresh fails", async () => {
    const rename = vi.fn().mockResolvedValue(undefined);
    const config = buildPlanExplorerConfig({
      plans: [plan], variables: {},
      fs: { mkdir: vi.fn().mockResolvedValue(undefined), rename, unlink: vi.fn(), readFile: vi.fn(), readdir: vi.fn(), stat: vi.fn() } as never,
      onRefresh: vi.fn().mockRejectedValue(new Error("refresh unavailable"))
    });
    const action = config.actions!.find((candidate) => candidate.id === "archive")!;

    await expect(action.handler({ row: { id: plan.absolutePath } as never, refresh: config.refresh!, toast: vi.fn() } as never))
      .rejects.toThrowError("refresh unavailable");
    expect(rename).toHaveBeenCalledWith("/repo/docs/plans/feature.md", "/repo/docs/plans/archive/feature.md");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that plan movement succeeds before the action returns the refresh error. Remove the disposable probe after running it.

## Observed Behavior

The archive action obtains the selected entry, awaits `archivePlan(entry, options.fs)` at `packages/plan-browser/src/explorer-config.ts:50` through `packages/plan-browser/src/explorer-config.ts:59`, and only afterwards awaits `ctx.refresh()` and displays an archive toast. `archivePlan()` creates the archive directory and moves the original file with `fs.rename(...)` at `packages/plan-browser/src/actions.ts:34` through `packages/plan-browser/src/actions.ts:45`. In the probe, `rename("/repo/docs/plans/feature.md", "/repo/docs/plans/archive/feature.md")` resolves, but the failed refresh causes the action handler to reject as though archiving failed.

## Expected Behavior

Once the archive move succeeds, a failed UI refresh should not make the committed destructive action appear to have failed. The action should preserve/report the archive success while separately communicating that the displayed list could not be refreshed.

## Impact

Transient discovery, config, or filesystem read failures during a refresh can mislead users into retrying archive operations after their plan has already moved. The browser displays failure behavior without acknowledging the completed destructive mutation, creating confusing recovery paths and possible secondary not-found errors.
