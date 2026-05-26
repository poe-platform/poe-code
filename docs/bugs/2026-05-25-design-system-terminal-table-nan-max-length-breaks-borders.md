# Design system terminal table NaN max length breaks borders

## Summary

The exported `@poe-code/design-system` `renderTable()` API accepts numeric column `maxLen` values without validating that they are finite. A terminal table column configured with `maxLen: NaN` renders zero-width borders while still emitting cell text followed by ellipses, producing a visibly malformed table layout.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dark, renderTable } from "./index.js";
import { withOutputFormat } from "./internal/output-format.js";

describe("renderTable NaN maximum length", () => {
  it("draws zero-width borders around unbounded ellipsized cells", () => {
    const output = withOutputFormat("terminal", () => renderTable({
      theme: dark,
      columns: [{ name: "name", title: "Name", alignment: "left", maxLen: Number.NaN }],
      rows: [{ name: "visible" }]
    }));

    expect(output).toContain("┌");
    expect(output).toContain("┐");
    expect(output).not.toContain("─");
    expect(output).toContain("visible…");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
rm -f packages/design-system/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/design-system/src/__probe__.test.ts > renderTable NaN maximum length > draws zero-width borders around unbounded ellipsized cells
```

## Observed Behavior

Terminal output for the single-column table has corner and vertical border characters but no horizontal border run, while the visible data row still contains `visible…`. In effect, the cells extend beyond a table whose calculated border width is zero.

`packages/design-system/src/index.ts` publicly exports `renderTable()`. `getColumnWidth()` calculates `Math.max(minWidth, column.maxLen)` at `packages/design-system/src/components/table.ts:207` through `packages/design-system/src/components/table.ts:212`, which yields `NaN` for a non-finite maximum. `renderBorder()` then repeats its horizontal segment with `column.width + 2` at `packages/design-system/src/components/table.ts:223` through `packages/design-system/src/components/table.ts:235`, resulting in no border span, while `truncateToWidth()` follows the malformed width and appends an ellipsis to ordinary cell strings.

## Expected Behavior

Table rendering should reject non-finite column lengths or normalize them to valid positive widths before computing borders and truncation. A malformed numeric option should not yield inconsistent geometry between borders and cell contents.

## Impact

SDK callers deriving column sizes from configuration or measured data can produce broken terminal tables without any explicit failure. This corrupts CLI readability and visual validation screenshots, making ordinary tabular output appear clipped or structurally damaged even when the underlying row data is valid.
