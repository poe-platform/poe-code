# Design System explorer detail action key runs while list pane has focus

## Summary

`@poe-code/design-system` defines `detail.actions` as operations against the focused detail item, but their keyboard bindings are active even while keyboard focus remains on the left-hand row list. A list-focused user can therefore trigger an operation on a detail item that is not the active interaction target.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { parseKeypress } from "../dashboard/terminal.js";
import { step } from "./reducer.js";
import { createInitialState, type DetailItem, type ExplorerConfig } from "./state.js";

describe("detail action focus probe", () => {
  it("dispatches a detail action while keyboard focus is still on the row list", async () => {
    const handler = vi.fn();
    const item: DetailItem = { id: "note", title: "Note", render: () => "body" };
    const config: ExplorerConfig<unknown> = {
      title: "Probe",
      rows: async () => [],
      actions: [],
      detail: {
        items: async () => [item],
        actions: [{ id: "comment", label: "Comment", key: "c", handler }]
      }
    };
    let state = step(createInitialState(config, { cols: 120, rows: 24 }), {
      type: "rowsLoaded",
      rows: [{ id: "one", title: "One" }]
    }).state;
    state = step(state, { type: "detailLoaded", rowId: "one", token: 1, items: [item] }).state;
    const key = parseKeypress(Buffer.from("c"));
    if (key === undefined) throw new Error("failed to parse key");

    const dispatched = step(state, { type: "key", key });
    const suspend = dispatched.effects[0];
    if (suspend?.type !== "suspend") throw new Error("expected suspend effect");
    await suspend.fn();

    expect(state.focused).toBe("list");
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ item }));
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
✓ packages/design-system/src/explorer/__probe__.test.ts > detail action focus probe > dispatches a detail action while keyboard focus is still on the row list
```

## Observed Behavior

The probe confirms `state.focused === "list"`, yet pressing the detail action key calls its handler with the loaded detail item in `ctx.item`. The public API describes `detail.actions` as running against the focused detail item at `packages/design-system/src/explorer/state.ts:21` and documents `item` as populated for detail actions at `packages/design-system/src/explorer/state.ts:40`. `resolveBindings()` nevertheless registers row and detail action keys together at `packages/design-system/src/explorer/keymap.ts:141`, and `stepKey()` dispatches any resolved action without checking the focused pane at `packages/design-system/src/explorer/reducer.ts:61`. `buildActionContext()` then supplies the current detail item solely because the action source is `detail` at `packages/design-system/src/explorer/actions.ts:36`.

## Expected Behavior

Detail-action key bindings should be active only while the detail pane is focused, or the API should explicitly describe them as global operations independent of pane focus. A list-focused keypress must not silently invoke an operation against an unfocused detail item.

## Impact

Keyboard shortcuts intended for detail review actions can execute while users are navigating rows, including comments, edits, or destructive detail-level operations. This makes pane focus misleading and increases the chance of acting on the wrong contextual item during rapid keyboard interaction.
