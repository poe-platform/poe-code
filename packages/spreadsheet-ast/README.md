# Spreadsheet AST

Work with spreadsheet data independently of Excel, OpenDocument or text files.
The model contains sheets, typed cells, formulas, names, styles, rich text and
retained metadata. It has no runtime dependencies, file access or format readers.

- Own immutable workbook snapshots with explicit storage budgets.
- Apply ordered cell updates without changing the original workbook.
- Parse and format A1 addresses and inspect populated cell ranges.
- Preserve raw byte-string cells, cached formulas and value-owned number formats.

```ts
import { snapshotWorkbook, updateWorkbook } from "@poe-platform/safe-bash/spreadsheet-ast";

const limits = {
  inputBytes: 1_000_000, outputBytes: 1_000_000,
  cells: 10_000, sheets: 16, operations: 100
};
const workbook = snapshotWorkbook({
  sheets: [{ id: "sales", name: "Sales", cells: [
    { row: 0, column: 0, value: { kind: "number", value: 42 } }
  ] }]
}, limits);
const edited = updateWorkbook(workbook, [
  { sheet: "sales", row: 0, column: 0, value: { kind: "number", value: 45 } }
], limits);
```

Snapshots reject accessors, cycles and unsupported host objects instead of
retaining them. `Infinity` explicitly permits unbounded storage. Updating a cell
does not recalculate formulas; use a spreadsheet engine for calculation and
selected format modules for file conversion.

This private workspace is bundled into the containing products. It is not a
separately published npm package.
