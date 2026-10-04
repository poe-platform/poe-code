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
With the engine's `workingFiles` capability, retained XLS imports keep CFB FAT,
sector-chain and directory traversal indexes in caller storage. Compound stream
payloads are read in bounded ranges with one FAT and one data sector cached;
ignored streams are validated structurally without copying their payloads.
The explicit byte-array API remains available. Retained imports index BIFF record
headers and per-sheet selections in caller storage and load record payloads on
demand. Decrypted replacements use fixed staging blocks, with transient plaintext
erased after staging. String CONTINUE payloads decode one record at a time.
Pending formulas and name records retain source coordinates rather than payload
arrays. Translation loads one format-bounded token stream and replays auxiliary
arrays, cached areas and label records on demand, including both name-binding passes. Font, number-format and XF catalogs share a
fixed index cache and caller backing. XF entries own their fixed-width style fields;
font metrics and styles replay on demand.
Decoded shared text and rich runs use caller storage with fixed descriptor and
payload windows for lookup. Scalar imports can replay ordered cells from caller
storage into streaming exporters, preserving cell styles and metadata. Formula
workbooks and global transformations keep the workbook path. Scalar row lookup
and insertion order also use caller storage, with rows and columns replayed to source
exporters. Formula/name identity maps, decoded expressions and individual array/label
values, final workbook metadata/styles, stream names and interpreted property/encryption
payloads still remain resident; this
does not yet provide bounded memory for the complete conversion.
Worksheet password verifiers survive BIFF7/8 conversion and edits through
`view.protectedPasswordHash`, an integer from 0 to 65535; zero clears the verifier.
This retains the legacy protection hash, without verifying passwords or encrypting
workbook contents. XLSX uses the same canonical verifier for cross-format transport;
other-format password transport remains unsupported.
Workbook-level `WINDOWPROTECT`, `PROTECT`, and `PASSWORD` records also survive
BIFF7/8 roundtrips and retained-record edits. Later supported records take
precedence; malformed payloads still report loss warnings. These settings remain
separate from worksheet protection. XLSX workbook structure/window flags and legacy
password verifiers also convert to BIFF7/8; unsupported protection fields retain
loss warnings.
BIFF starting-page words survive import/export through `PrintInformation`
`first_page_number` metadata, following Gnumeric's native record behavior.
The separate print enable flag and XML transport remain unqualified.
Print copy counts also survive BIFF7/8 and XLSX transport and metadata edits;
BIFF output rejects counts outside its unsigned 16-bit range.
BIFF editing preserves the workbook Normal style and font-aware column widths,
including sheet defaults. Change `sheet.view.defaultColumnWidth` in points and
adopt the edited workbook before export; BIFF stores defaults in whole font
characters and explicit widths in its finer integer units.
Set `sheet.view.defaultRowHeight` in points to change the sheet row default;
BIFF quantizes it to twentieth-points. Nonrepresentable defaults are rejected.
Custom row heights use 15-bit twentieth-points; values outside that range are
rejected unless they inherit the sheet default. Imported fixed and automatic
row sizing is preserved through the shared row metadata.
Sheet protection uses `sheet.view.gnumeric.Protected` (`"1"` or `"0"`).
BIFF8 also preserves boolean permissions in `sheet.view.protectedAllow`: `objects`,
`scenarios`, `formatCells`, `formatColumns`, `formatRows`, `insertColumns`,
`insertRows`, `insertHyperlinks`, `deleteColumns`, `deleteRows`, `selectLockedCells`,
`sort`, `autoFilter`, `pivotTables`, and `selectUnlockedCells`. Unspecified
permissions use native defaults: selecting cells is allowed; other actions are
not. BIFF7 reports loss of nondefault permissions. XLSX shares this canonical
permission map; other-format permission transport remains outside this support.
The formula reader rejects malformed shared formulas containing BIFF live-label
tokens; ordinary cell and array formulas retain their supported live labels.
BIFF8 re-export preserves imported external-name cell, area and error definitions,
including their original external sheet order. Import and export do not fetch links;
recalculation still requires an explicit host. Other definition forms and newly
constructed external names are not covered by this preservation.
For tabular imports, the `./cached` entrypoint reads BIFF2–8 cached values,
including BIFF4 workbook containers, without translating formulas or names.
It preserves raw error codes, encoding overrides, worksheet order and number
formats, and admits CFB, record, string and cell storage through caller budgets.
This value-only reader excludes formatting-only blank cells and ignores DIMENSION
hints; the ordinary engine reader retains its editing and recalculation model.
Existing ssconvert service IDs, supported profiles and documented fidelity limits
remain unchanged. This private workspace is shipped through the containing
products, not as a separate npm publication.
