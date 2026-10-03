# XLSX workbook AST

Read and write XLSX workbooks using the shared spreadsheet model and explicit
resource limits, cancellation and host capabilities. The implementation covers
worksheet cells, formulas, styles, names, comments and workbook metadata.
Formula exports preserve control characters and literal escape tokens in cells,
defined names, validation rules and conditional formatting.
Custom error caches use Gnumeric’s quoted error syntax; imports retain the stored
cache text, including its quotes, as Gnumeric does. Fixed and automatic row/column
sizing survives workbook and clipboard conversions, including best-fit columns.
Nonpositive row heights and column widths up to four points retain default
dimensions and their visibility/outline metadata, matching native import.
Repeated column records preserve earlier accepted widths and outlines; hidden
groups retain their adjacent collapsed summary markers.

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

For table import, `readCachedXlsx` accepts an admitted ZIP archive, its codec and
limits, a cancellation signal, and aggregate `work`/`retain` admission callbacks.
It returns stored values without parsing formulas, preserves ISO date strings and
declared dimensions, and exposes the workbook epoch and active sheet index.
Built-in number formats remain numeric IDs; custom formats remain strings.

This private workspace is shipped through the containing products. The full
`readXlsx` reader retains its Gnumeric compatibility profile and documented
fidelity limits.
