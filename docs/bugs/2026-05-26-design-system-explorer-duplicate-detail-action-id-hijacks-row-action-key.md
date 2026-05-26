# Design System explorer duplicate detail action ID hijacks row action key

## Summary

`@poe-code/design-system` explorer configurations may declare a row action and a detail action with the same `id` without an error. When the row action owns a keyboard binding, pressing that key executes the later detail action handler instead of the row action that declared the binding.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, type ExplorerConfig } from "./state.js";

describe("duplicate explorer action id probe", () => {
  it("dispatches a detail action when the row action key is pressed", async () => {
    const rowHandler = vi.fn();
    const detailHandler = vi.fn();
    const config: ExplorerConfig<unknown> = {
      title: "Probe",
      rows: async () => [],
      actions: [{ id: "open", label: "Open row", key: "o", handler: rowHandler }],
      detail: {
        items: async () => [],
        actions: [{ id: "open", label: "Open detail", handler: detailHandler }]
      }
    };
    const loaded = step(createInitialState(config, { cols: 120, rows: 24 }), {
      type: "rowsLoaded",
      rows: [{ id: "one", title: "One" }]
    }).state;
    const key = parseKeypress(Buffer.from("o"));
    if (key === undefined) throw new Error("failed to parse key");

    const dispatched = step(loaded, { type: "key", key });
    const suspend = dispatched.effects[0];
    if (suspend?.type !== "suspend") throw new Error("expected suspend effect");
    await suspend.fn();

    expect(rowHandler).not.toHaveBeenCalled();
    expect(detailHandler).toHaveBeenCalledOnce();
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
✓ packages/design-system/src/explorer/__probe__.test.ts > duplicate explorer action id probe > dispatches a detail action when the row action key is pressed
```

## Observed Behavior

The row action declares `key: "o"`, yet pressing `o` calls only the detail handler. `resolveBindings()` records the binding against the shared action ID at `packages/design-system/src/explorer/keymap.ts:141`, while `createInitialActionState()` inserts row actions and then overwrites same-ID entries with detail actions at `packages/design-system/src/explorer/state.ts:181` and `packages/design-system/src/explorer/state.ts:190`. `resolveAction()` subsequently retrieves the overwritten detail handler by ID at `packages/design-system/src/explorer/actions.ts:24`, and `stepKey()` dispatches it at `packages/design-system/src/explorer/reducer.ts:76`.

## Expected Behavior

The explorer should reject duplicate action IDs across row and detail action scopes, namespace those scopes independently, or preserve the handler associated with the declared keyboard binding. A key assigned to a row action must not silently invoke a different detail action.

## Impact

Interactive explorer screens can execute the wrong user-visible operation when action IDs overlap, including destructive or context-specific detail actions triggered through a row-level shortcut. The collision is silent and configuration-valid at construction time, so users may not discover the misrouting until an unintended operation has already run.
