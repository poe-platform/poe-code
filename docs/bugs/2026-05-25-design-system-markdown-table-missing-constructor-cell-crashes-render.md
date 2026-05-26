# Design system Markdown table missing constructor cell crashes render

## Summary

The exported `@poe-code/design-system` `renderTable()` API reads table cells through ordinary property lookup. In Markdown output mode, declaring a `constructor` column and rendering a row that does not own that key retrieves `Object.prototype.constructor` instead of an empty cell, then passes that inherited function to the string-only ANSI stripper and throws.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dark, renderTable } from "./index.js";
import { withOutputFormat } from "./internal/output-format.js";

describe("renderTable inherited constructor cells", () => {
  it("throws for a missing constructor cell inherited from Object.prototype", () => {
    expect(() => withOutputFormat("markdown", () => renderTable({
      theme: dark,
      columns: [{ name: "constructor", title: "Value", alignment: "left", maxLen: 20 }],
      rows: [{ constructor: "present" }, {}]
    }))).toThrowError();
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
✓ packages/design-system/src/__probe__.test.ts > renderTable inherited constructor cells > throws for a missing constructor cell inherited from Object.prototype
```

## Observed Behavior

With Markdown output selected, `renderTable()` throws when its `columns` include `constructor` and any row omits an own `constructor` cell. The sparse row does not render as an empty table cell; rendering fails entirely.

`packages/design-system/src/index.ts` publicly exports `renderTable()`. The Markdown renderer reads each cell as `row[c.name] ?? ""` and immediately calls `stripAnsi(...)` at `packages/design-system/src/components/table.ts:281` through `packages/design-system/src/components/table.ts:303`. For `c.name === "constructor"` on an otherwise empty ordinary object row, that lookup yields inherited `Object.prototype.constructor`, not `undefined`. `stripAnsi()` in `packages/design-system/src/internal/strip-ansi.ts:1` expects a string and calls `.replace(...)` on the inherited function, causing the render to throw.

## Expected Behavior

Table cells should be read only from own row properties, with missing cells rendered as empty text regardless of special JavaScript prototype property names. A declared column should not make sparse Markdown table rendering throw.

## Impact

SDK users rendering dynamic tabular data can crash terminal or Markdown output when an input schema, external record, or generated column is legitimately named `constructor` and not populated in every row. A missing value becomes an exception rather than a blank cell, preventing display of otherwise valid results.
