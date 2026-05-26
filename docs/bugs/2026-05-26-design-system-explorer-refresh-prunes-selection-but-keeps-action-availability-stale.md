# Design System explorer refresh prunes selection but keeps action availability stale

## Summary

`@poe-code/design-system` explorer removes selected IDs that disappear during a row refresh, but recomputes action predicates using the pre-refresh selection set. An action can therefore remain unavailable even though the visible replacement row now satisfies its predicate and the stored selection is already empty.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { step } from "./reducer.js";
import { createInitialState, type ExplorerConfig } from "./state.js";

describe("explorer selection refresh action-state probe", () => {
  it("leaves a focused-row action unavailable after its removed selection is pruned", () => {
    const config: ExplorerConfig<unknown> = {
      title: "Probe",
      rows: async () => [],
      detail: { items: async () => [] },
      actions: [{
        id: "open",
        label: "Open",
        predicate: (ctx) => ctx.rows.length === 1 && ctx.rows[0]?.id === "replacement",
        handler: () => undefined
      }]
    };
    let state = step(createInitialState(config, { cols: 120, rows: 24 }), {
      type: "rowsLoaded",
      rows: [{ id: "removed", title: "Removed" }]
    }).state;
    state = { ...state, selected: new Set(["removed"]) };

    state = step(state, {
      type: "rowsLoaded",
      rows: [{ id: "replacement", title: "Replacement" }]
    }).state;

    expect([...state.selected]).toEqual([]);
    expect(state.actionState.get("open")?.available).toBe(false);
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
✓ packages/design-system/src/explorer/__probe__.test.ts > explorer selection refresh action-state probe > leaves a focused-row action unavailable after its removed selection is pruned
```

## Observed Behavior

After refreshing from the selected row `removed` to the visible row `replacement`, `state.selected` is empty while `state.actionState.get("open")?.available` remains `false`. In `rowsLoaded()`, the next state writes `selected: pruneSelection(state.selected, rows)` at `packages/design-system/src/explorer/reducer.ts:248`, but constructs `actionState` with `{ ...state, rows, filtered, matchPositions, cursor }` at `packages/design-system/src/explorer/reducer.ts:251`, omitting that pruned selection. `recomputeActionState()` then evaluates action predicates through `buildActionContext()` at `packages/design-system/src/explorer/reducer.ts:755`, which still resolves rows from the obsolete selected ID via `packages/design-system/src/explorer/actions.ts:36`.

## Expected Behavior

When refreshed rows prune invalid selection IDs, action predicates should be recomputed against the same pruned selection stored in the resulting state. The action for the newly focused replacement row should be available immediately after the refresh.

## Impact

Explorer screens can hide or disable actions for valid refreshed rows until an additional user interaction forces another action-state recomputation. In task browsers and management TUIs, a newly visible actionable item may appear inert after refresh, causing users to miss required operations or perform unnecessary navigation to restore correct controls.
