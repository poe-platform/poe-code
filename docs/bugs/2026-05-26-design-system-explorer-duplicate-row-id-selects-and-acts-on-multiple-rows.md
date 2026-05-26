# Design System explorer duplicate row ID selects and acts on multiple rows

## Summary

`@poe-code/design-system` explorer accepts multiple visible rows with the same `id` and represents selection only as a `Set<string>` of IDs. Selecting one duplicate row therefore selects every row sharing its ID when an action builds its selected-row context.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, type ExplorerConfig } from "./state.js";

describe("duplicate explorer row id probe", () => {
  it("applies a selected-row action to both rows after selecting only one", async () => {
    const handler = vi.fn();
    const config: ExplorerConfig<unknown> = {
      title: "Probe",
      rows: async () => [],
      multiSelect: true,
      detail: { items: async () => [] },
      actions: [{ id: "archive", label: "Archive", key: "a", handler }]
    };
    let state = step(createInitialState(config, { cols: 120, rows: 24 }), {
      type: "rowsLoaded",
      rows: [
        { id: "duplicate", title: "First" },
        { id: "duplicate", title: "Second" }
      ]
    }).state;
    const select = parseKeypress(Buffer.from(" "));
    const archive = parseKeypress(Buffer.from("a"));
    if (select === undefined || archive === undefined) throw new Error("failed to parse key");

    state = step(state, { type: "key", key: select }).state;
    const dispatched = step(state, { type: "key", key: archive });
    const suspend = dispatched.effects[0];
    if (suspend?.type !== "suspend") throw new Error("expected suspend effect");
    await suspend.fn();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          expect.objectContaining({ title: "First" }),
          expect.objectContaining({ title: "Second" })
        ]
      })
    );
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
✓ packages/design-system/src/explorer/__probe__.test.ts > duplicate explorer row id probe > applies a selected-row action to both rows after selecting only one
```

## Observed Behavior

After selecting only the first visible row, invoking the row action receives both `First` and `Second` in `ctx.rows`. The public `Row` contract exposes an unrestricted string `id` at `packages/design-system/src/explorer/state.ts:5`; selection stores only that ID in a `Set` in `packages/design-system/src/explorer/reducer.ts:498` through `packages/design-system/src/explorer/reducer.ts:540`. When an action is dispatched, `selectedRows()` filters all loaded rows by membership of the shared ID at `packages/design-system/src/explorer/actions.ts:66`, and the complete aliased set is passed to the handler from `packages/design-system/src/explorer/reducer.ts:706`.

## Expected Behavior

Explorer rows should either require unique IDs and reject duplicate input, or selection should identify the exact visible row selected by the user. Selecting one row must not silently expand an action to additional rows merely because they reuse the same identifier.

## Impact

Multi-select actions such as archive, delete, transition, or bulk-edit can affect unintended records when a data source emits duplicate row IDs. The user selects one displayed row, but the action handler receives multiple targets without any warning, making destructive UI operations unsafe under otherwise accepted input.
