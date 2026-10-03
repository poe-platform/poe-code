# XLS spreadsheets

Add XLS reading and writing to a spreadsheet engine without installing
other file-format implementations. The module uses the shared spreadsheet AST
and explicit resource, cancellation and host-capability contracts.

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { xlsFormat } from "poe-code/ssconvert/formats/xls";

const engine = createEngine({ formats: [xlsFormat] });
try {
  console.log(engine.listServices("read"));
  console.log(engine.listServices("write"));
} finally {
  await engine.dispose();
}
```

Compose additional format modules explicitly to convert between file types.
BIFF editing preserves the workbook Normal style and font-aware column widths,
including sheet defaults. Change `sheet.view.defaultColumnWidth` in points and
adopt the edited workbook before export; BIFF stores defaults in whole font
characters and explicit widths in its finer integer units.
Set `sheet.view.defaultRowHeight` in points to change the sheet row default;
BIFF quantizes it to twentieth-points. Nonrepresentable defaults are rejected.
The formula reader rejects malformed shared formulas containing BIFF live-label
tokens; ordinary cell and array formulas retain their supported live labels.
For tabular imports, the `./cached` entrypoint reads BIFF2–8 cached values,
including BIFF4 workbook containers, without translating formulas or names.
It preserves raw error codes, encoding overrides, worksheet order and number
formats, and admits CFB, record, string and cell storage through caller budgets.
This value-only reader excludes formatting-only blank cells and ignores DIMENSION
hints; the ordinary engine reader retains its editing and recalculation model.
Existing ssconvert service IDs, supported profiles and documented fidelity limits
remain unchanged. This private workspace is shipped through the containing
products, not as a separate npm publication.
