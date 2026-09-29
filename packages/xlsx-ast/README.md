# XLSX workbook AST

Read and write XLSX workbooks using the shared spreadsheet model and explicit
resource limits, cancellation and host capabilities. The implementation covers
worksheet cells, formulas, styles, names, comments and workbook metadata.

```ts
import { createEngine } from "@poe-code/spreadsheet-engine";
import { readXlsx, probeXlsx, createXlsxWriter } from "@poe-code/xlsx-ast";

const engine = createEngine({ codecs: [{
  id: "xlsx", description: "XLSX workbook", extensions: ["xlsx"],
  probeContent: probeXlsx, contentProbe: true,
  read: readXlsx, write: createXlsxWriter("2008")
}] });
```

Supply explicit input/output streams and operation options to the engine, then
call `engine.dispose()` when finished. The existing XLSX format module provides
ssconvert service registration around these same functions.

This private workspace is shipped through the containing products. Its current
Gnumeric compatibility profile and documented fidelity limits still apply;
raw ISO-date provenance for CSVKit is not yet implemented here.
