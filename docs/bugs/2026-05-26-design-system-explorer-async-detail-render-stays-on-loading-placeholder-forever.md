# Design System explorer async detail render stays on loading placeholder forever

## Summary

`@poe-code/design-system` publicly allows each explorer `DetailItem.render()` implementation, including the helper returned by `singleDetail()`, to return `Promise<string>`. The renderer never awaits or stores the fulfilled value, so an asynchronous detail render displays `Loading detail...` permanently even after its content promise has resolved.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/render/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { REGION_DETAIL } from "../state.js";
import { fixtureState, renderStateSnapshot } from "./test-fixtures.js";

describe("async detail render probe", () => {
  it("keeps showing a loading placeholder after render content has already resolved", async () => {
    const rendered = Promise.resolve("Resolved async detail");
    await rendered;

    const snapshot = renderStateSnapshot(fixtureState({
      dirty: REGION_DETAIL,
      detail: {
        rowId: "27",
        items: [{ id: "async", render: () => rendered }],
        cursor: 0,
        scroll: 0,
        token: 1,
        loading: false
      }
    }));

    expect(snapshot).toContain("Loading detail...");
    expect(snapshot).not.toContain("Resolved async detail");
  });
});
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/design-system/src/explorer/render/__probe__.test.ts --reporter verbose
rm packages/design-system/src/explorer/render/__probe__.test.ts
```

Observed test output:

```text
✓ packages/design-system/src/explorer/render/__probe__.test.ts > async detail render probe > keeps showing a loading placeholder after render content has already resolved
```

## Observed Behavior

The probe supplies an already-fulfilled detail promise containing `Resolved async detail`, but rendering still includes only `Loading detail...`. The public `DetailItem` contract permits `render: (ctx) => string | Promise<string>` at `packages/design-system/src/explorer/state.ts:13`, and `singleDetail()` explicitly forwards a potentially asynchronous render function at `packages/design-system/src/explorer/index.ts:29`. However, `renderItem()` immediately replaces every non-string result with the placeholder text at `packages/design-system/src/explorer/render/detail.ts:103`; no completion event or state update exists to render the promised string later.

## Expected Behavior

The explorer should either support the declared asynchronous rendering contract by awaiting resolved content and scheduling a redraw, or restrict the public API to synchronous detail render functions. A fulfilled `Promise<string>` accepted by the public type must eventually appear in the detail pane.

## Impact

Consumers using the documented type surface to load detail text asynchronously can never display that content. The explorer remains stuck on a loading placeholder for affected detail panes, hiding requested information and making `singleDetail(async ...)` configurations silently unusable.
