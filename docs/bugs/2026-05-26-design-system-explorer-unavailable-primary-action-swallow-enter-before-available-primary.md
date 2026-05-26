# Design System explorer unavailable primary action swallows Enter before available primary

## Summary

`@poe-code/design-system` explorer permits multiple actions to declare `primary: true`, meaning they are candidates for Enter dispatch. If the first primary action is unavailable while a later primary action is available, pressing Enter runs nothing because selection stops at the first primary entry before availability is considered.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, type ExplorerConfig } from "./state.js";

describe("explorer primary action probe", () => {
  it("ignores an available primary action after an unavailable primary action", async () => {
    const hidden = vi.fn();
    const available = vi.fn();
    const config: ExplorerConfig<unknown> = {
      title: "Probe",
      rows: async () => [],
      detail: { items: async () => [] },
      actions: [
        { id: "hidden", label: "Hidden", primary: true, predicate: () => false, handler: hidden },
        { id: "available", label: "Available", primary: true, predicate: () => true, handler: available }
      ]
    };
    const state = step(createInitialState(config, { cols: 120, rows: 24 }), {
      type: "rowsLoaded",
      rows: [{ id: "one", title: "One" }]
    }).state;
    const enter = parseKeypress(Buffer.from("\r"));
    if (enter === undefined) throw new Error("failed to parse enter");

    const dispatched = step(state, { type: "key", key: enter });

    expect(state.actionState.get("hidden")?.available).toBe(false);
    expect(state.actionState.get("available")?.available).toBe(true);
    expect(dispatched.effects).toEqual([]);
    expect(hidden).not.toHaveBeenCalled();
    expect(available).not.toHaveBeenCalled();
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
✓ packages/design-system/src/explorer/__probe__.test.ts > explorer primary action probe > ignores an available primary action after an unavailable primary action
```

## Observed Behavior

The state marks `hidden` unavailable and `available` available, yet pressing Enter yields no action effect. The public `Action` type allows each action to independently set `primary?: boolean` at `packages/design-system/src/explorer/state.ts:28`. `confirmKey()` delegates Enter to `dispatchPrimary()` at `packages/design-system/src/explorer/reducer.ts:489`, which returns dispatch for the first entry whose action has `primary === true` at `packages/design-system/src/explorer/reducer.ts:682`. Only after that choice does `dispatchActionById()` test availability and return no effects for the unavailable first action at `packages/design-system/src/explorer/reducer.ts:692`, without considering the later available primary.

## Expected Behavior

If more than one primary action is accepted, Enter dispatch should choose an available non-running primary action rather than stopping on an unavailable candidate. Alternatively, the explorer should reject configurations that declare more than one primary action instead of silently producing order-dependent routing.

## Impact

Explorer screens with conditional primary actions can display an actionable row while Enter unexpectedly does nothing, depending on declaration order and predicate state. Users lose the expected default action and may incorrectly conclude that the row is unavailable or that keyboard interaction is broken.
