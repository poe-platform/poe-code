# Plan browser duplicate row path displays later plan detail

## Summary

The exported `@poe-code/plan-browser` explorer renders every supplied plan entry as a visible row but indexes entries for detail and action lookup in a `Map` keyed only by `absolutePath`. If two input entries share one absolute path, the later entry silently overwrites the lookup value, so selecting the earlier visible row displays the later plan's detail instead of the selected row's content.

## Reproduction

Create a disposable probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPlanExplorerConfig } from "./explorer-config.js";
import type { PlanEntry } from "./types.js";

describe("plan browser duplicate row identity", () => {
  it("shows the later plan detail when the earlier duplicate row is selected", async () => {
    const first: PlanEntry = {
      path: "docs/plans/first.md",
      absolutePath: "/repo/docs/plans/shared.md",
      kind: "plan",
      typeLabel: "Plan",
      detail: "first summary",
      format: "markdown",
      title: "First",
      updatedAt: 1
    };
    const second: PlanEntry = {
      ...first,
      path: "docs/plans/second.md",
      detail: "second summary",
      title: "Second",
      updatedAt: 2
    };
    const config = buildPlanExplorerConfig({
      plans: [first, second],
      fs: {} as never,
      variables: {},
      onRefresh: async () => [first, second],
      loadDetailMarkdown: async (entry) => `# ${entry.title}`
    });
    const rows = await config.rows();

    expect(rows.map((row) => row.subtitle)).toEqual(["first summary", "second summary"]);
    await expect(
      config.detail!.items(rows[0]!, { signal: new AbortController().signal } as never)
        .then((items) => items[0]?.render())
    ).resolves.toBe("# Second");
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm packages/plan-browser/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/plan-browser/src/__probe__.test.ts > plan browser duplicate row identity > shows the later plan detail when the earlier duplicate row is selected

Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

`buildPlanExplorerConfig()` converts the full input array into rows at `packages/plan-browser/src/explorer-config.ts:25` through `packages/plan-browser/src/explorer-config.ts:27` and `packages/plan-browser/src/explorer-config.ts:118` through `packages/plan-browser/src/explorer-config.ts:125`, so both colliding entries remain visible with their distinct subtitles. It separately builds `entryByRowId` with `new Map(plans.map((entry) => [entry.absolutePath, entry]))` at `packages/plan-browser/src/explorer-config.ts:128` through `packages/plan-browser/src/explorer-config.ts:130`; the later entry replaces the earlier value for the shared row ID. Detail loading uses that map at `packages/plan-browser/src/explorer-config.ts:93` through `packages/plan-browser/src/explorer-config.ts:109`, so selecting the displayed `first summary` row returns `# Second`.

## Expected Behavior

Each visible row must resolve to the same `PlanEntry` whose summary it displays. The explorer should use a row identity that cannot collide for separate entries, or reject/deduplicate duplicate input paths before rendering misleading rows.

## Impact

When plan discovery or an integrating caller provides duplicate path identities, the browser can show one plan in the list while previewing and acting on another. Users can inspect, edit, archive, or delete the wrong document while the selected row suggests a different plan, making interactive plan management unsafe under duplicate-entry conditions.
