# XLSX workbook AST

Read and write XLSX workbooks using the shared spreadsheet model and explicit
resource limits, cancellation and host capabilities. The implementation covers
worksheet cells, formulas, styles, names, comments and workbook metadata.
Formula exports preserve control characters and literal escape tokens in cells,
defined names, validation rules and conditional formatting.
Imports resolve numbered external links to their declared workbook paths in cell,
shared, array and defined-name formulas. They do not fetch linked files;
recalculation uses only the explicit host resolver. Exports include numbered external-workbook relationships for live cell/range
references and local names that refer to them, including quoted sheet names.
Imported XLSX external-name definitions retain their workbook and sheet scope
when links are reordered, including case-insensitive name bindings. Names without
a retained definition still produce a loss warning. External cached data remains
separate from live host resolution.
Custom error caches use Gnumeric’s quoted error syntax; imports retain the stored
cache text, including its quotes, as Gnumeric does. Fixed and automatic row/column
sizing survives workbook and clipboard conversions, including best-fit columns.
Nonpositive row heights and column widths up to four points retain default
dimensions and their visibility/outline metadata, matching native import.
Repeated column records preserve earlier accepted widths and outlines; hidden
groups retain their adjacent collapsed summary markers. Repeated row records
preserve accepted heights and hidden state, while explicit outline resets apply
in native order. Row summary markers survive XLSX re-export at outline level zero.
Late worksheet defaults preserve heights already allocated by values, formulas,
visibility or outlines; empty rows use the final default. Repeated default-format
records are combined on export. Repeated cell coordinates update one cell in source order: blank records preserve prior values, explicit empty strings replace them, and value-only updates retain live formulas. Uncached replacement formulas retain the previous cached value and rich text while remaining dirty until recalculation. Missing inline-string payloads stay blank;
explicit empty payloads remain empty strings.

```ts
import { createEngine } from "@poe-code/spreadsheet-engine";
import { readXlsx, probeXlsx, createXlsxWriter, createXlsxStreamWriter } from "@poe-code/xlsx-ast";

const engine = createEngine({ codecs: [{
  id: "xlsx", description: "XLSX workbook", extensions: ["xlsx"],
  probeContent: probeXlsx, probeSource: probeXlsx, contentProbe: true,
  read: readXlsx, readSource: readXlsx, write: createXlsxWriter("2008"),
  writeStream: createXlsxStreamWriter("2008")
}] });
```

Supply explicit input/output streams and operation options to the engine, then
call `engine.dispose()` when finished. The existing XLSX format module provides
ssconvert service registration around these same functions. Both readers accept
retained range sources as well as byte arrays. Range input fetches ZIP metadata
and requested member data in chunks of at most 16 KiB, without copying the whole
compressed archive. Keep the source open until the operation settles. This does
not yet bound decoded XML documents or the workbook model; large workbook
conversion still requires further storage migration. With engine `workingFiles`,
the directory and member indexes use caller-backed scratch storage and bounded
caches. Without that capability the convenience reader retains the directory.

`createXlsxStreamWriter` uses `workingFiles` to stage ZIP member payloads and
central records in the caller’s safe-fs. XML encoding and member compression
consume bounded chunks, followed by bounded archive output. The
format provider registers this path for both editions. Worksheet XML, shared
strings and workbook cells still use in-memory representations. Hosts without
working storage and explicit `createXlsxWriter` calls retain buffered output.

For table import, `readCachedXlsx` accepts an admitted ZIP archive, its codec and
limits, a cancellation signal, and aggregate `work`/`retain` admission callbacks.
It returns stored values without parsing formulas, preserves ISO date strings and
declared dimensions, and exposes the workbook epoch and active sheet index.
Built-in number formats remain numeric IDs; custom formats remain strings.

This private workspace is shipped through the containing products. The full
`readXlsx` reader retains its Gnumeric compatibility profile and documented
fidelity limits.
