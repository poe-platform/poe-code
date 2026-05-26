# Design System explorer refresh discards confirmation without resolving awaiting action

## Summary

`@poe-code/design-system` explorer can silently discard a confirmation modal created by `ctx.confirm()` when a row refresh removes the modal's captured row. The modal disappears, but its stored resolver is never invoked, leaving the action awaiting `ctx.confirm()` permanently pending.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { step } from "./reducer.js";
import { createInitialState, type ExplorerConfig } from "./state.js";

describe("explorer confirmation invalidation probe", () => {
  it("drops a confirm modal on refresh without resolving its promise", async () => {
    let resolveConfirm: ((accepted: boolean) => void) | undefined;
    const confirmation = new Promise<boolean>((resolve) => { resolveConfirm = resolve; });
    const config: ExplorerConfig<unknown> = {
      title: "Probe",
      rows: async () => [],
      detail: { items: async () => [] },
      actions: []
    };
    let state = step(createInitialState(config, { cols: 120, rows: 24 }), {
      type: "rowsLoaded",
      rows: [{ id: "removed", title: "Removed" }]
    }).state;
    state = {
      ...state,
      modal: {
        kind: "confirm",
        action: { id: "__confirm__", label: "Proceed?", handler: () => undefined },
        rows: [{ id: "removed", title: "Removed" }],
        resolver: resolveConfirm!
      }
    };

    state = step(state, { type: "rowsLoaded", rows: [{ id: "replacement", title: "Replacement" }] }).state;
    const settlement = vi.fn();
    void confirmation.then(settlement);
    await Promise.resolve();

    expect(state.modal).toBeNull();
    expect(settlement).not.toHaveBeenCalled();
  });
});
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/design-system/src/explorer/__probe__.test.ts --reporter verbose
rm packages/design-system/src/explorer/__probe__.test.ts
```

Observed test output:

```text
✓ packages/design-system/src/explorer/__probe__.test.ts > explorer confirmation invalidation probe > drops a confirm modal on refresh without resolving its promise
```

## Observed Behavior

Refreshing the row set from `removed` to `replacement` changes `state.modal` to `null`, but a promise wired to the modal's resolver remains unsettled. `ExplorerRuntime.confirm()` creates a promise and stores only its resolver on the modal at `packages/design-system/src/explorer/runtime.ts:212`. Normal modal dismissal calls that resolver in `modalDismissed()` at `packages/design-system/src/explorer/reducer.ts:349`. However, `rowsLoaded()` replaces the modal with `modalStillValid(...)` at `packages/design-system/src/explorer/reducer.ts:250`, and `modalStillValid()` returns `null` for removed rows at `packages/design-system/src/explorer/reducer.ts:873` without resolving the discarded modal.

## Expected Behavior

If a refresh invalidates an outstanding confirmation, the explorer should explicitly dismiss it and resolve the awaiting `ctx.confirm()` promise, normally as `false`, before removing the modal from state. An action must not be left awaiting a UI prompt that no longer exists.

## Impact

Any explorer action that awaits `ctx.confirm()` can hang indefinitely when another refresh removes its focused row while the prompt is open. The action remains in-flight without user-visible modal controls to complete it, potentially keeping action locks active and preventing the workflow from progressing until the explorer is abandoned.
