# Spreadsheet conversion

Convert spreadsheets through the `poe-code/ssconvert` SDK on Node.js 22 or newer.
The engine provides spreadsheet import and export, recalculation, workbook updates,
and chart and print rendering. PDF export applies persisted manual and data-slice row/column page breaks and recomputes stored automatic breaks. Lotus WK1/WK3 named-range records import as workbook names; WK3 formulas resolve named ranges with relative and absolute references. The optional `pythonSampleFunctions` binding adds
percent formatting through `PY_PRINTF` and Unicode 16 capitalization through `PY_CAPWORDS`; supply it as `runtimeFunctions` to enable
the sample functions. `PY_BITAND` delegates to the spreadsheet bitwise function; invalid bit domains return an empty cell with the native Python bridge warning. `PY_CAPWORDS` stops at the first NUL and refuses malformed visible Unicode.
Cooperative `runtimeFunctions` ports can return scalar values, rectangular matrices,
and references to invocation-owned sheets; arrays are copied and bounded, and returned
references retain their dependencies.
`isSsconvertError(error)` recognizes typed failures across the separately bundled SDK and Shell exports.
The optional `perlSampleFunctions` binding adds clock-based dates
and bounded pattern substitution with literal replacements. Native byte results
use an explicit `byte-string` value with lowercase hex, preserving invalid UTF-8
through qualified text formulas, arrays and CSV output. LOWER/UPPER use captured
Unicode 16 C-locale case behavior, including native byte values. CLEAN, PROPER, REPT, REPLACE/REPLACEB, SUBSTITUTE, FIND/FINDB, SEARCH/SEARCHB and LENB/LEFTB/RIGHTB/MIDB
also accept native byte values. Wider Perl grammar,
diagnostics and byte consumers remain documented gaps. It also opens XOR-obfuscated and RC4-encrypted Excel workbooks (standard and CryptoAPI)
using the native reader's built-in password or an explicit host `password.read` callback. AES/Blowfish-encrypted OpenDocument spreadsheets open through the same host callback. Encrypted Paradox tables open automatically using their declared header key. The optional `createDatabaseFunctions(query)` binding runs EXECSQL/READDBTABLE through an explicit cooperative host query port, with read-only requests and bounded owned recordsets. Format support has documented limits; see the
[usage guide](../../docs/ssconvert/usage-draft.md) for examples and capabilities.

```ts
import { createEngine } from "poe-code/ssconvert";

const engine = createEngine({
  codecs: [],
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: {
    inputBytes: 1_000_000, outputBytes: 1_000_000,
    cells: 10_000, sheets: 16, operations: 100
  }
});
try {
  console.log(engine.listServices("read"));
  console.log(engine.listServices("write"));
} finally {
  await engine.dispose();
}
```

Filesystem and network access require explicit host bindings. The engine never
uses a native spreadsheet converter as a fallback. BIFF8 external cell and area
links calculate to `#REF!`; their cached values and raw link records remain retained,
and linked workbooks are never fetched. Safe Bash provides a separate,
opt-in `ssconvertCommands` plugin using the same engine.
The optional `datasource` binding enables `ATL_LAST(tag)` through an owned host
transport. Each operation opens a separate session; successful default solver
processing polls one finite available byte batch and closes the transport after
the operation. Custom solvers can process additional batches through
`context.datasource.poll(book)`. Supply `tag:number\n` byte records; partial
records carry across batches. Transport acquisition and OS timing belong to the
host binding.

Configurable text export (`Gnumeric_stf:stf_assistant`) remembers a text input's
unique LF, CRLF or CR terminator unless an explicit `eol` option overrides it;
plain CSV export continues to use LF.

SYLK export preserves explicit cell and column formats. CSV text-entry formats
(such as inferred times and month/day/year dates) export as General, matching
Gnumeric; their numeric values and imported display formats remain intact.
Set a cell's `format` and clear `inferredValueFormat` to make that format explicit.

This workspace is private and is distributed through the `poe-code` SDK subpath.

For encrypted BIFF imports, `createEngine({ ...config, password: { read: readWorkbookPassword } })` asks only after the built-in password fails. The callback receives the algorithm, revision, input filename when available, encoding, maximum byte length and invocation cancellation signal. Return a string or UTF-16LE bytes for RC4 (up to 255 UTF-16 code units); XOR requires explicitly encoded bytes (0–15). Return `undefined` to decline. Passwords never come from command arguments or guest environment variables, and callback failures produce a sanitized diagnostic. OpenDocument AES-CBC and Blowfish-CFB8 imports accept UTF-8 strings or bytes through this callback, supporting AES128/192/256 and Blowfish4–56-byte keys, SHA1/SHA256 start keys and prefix/full checksums. The callback runs once after every encrypted member is admitted; malformed Unicode is rejected. All encrypted members are verified before conversion. Encryption is read-only; exports contain plaintext. BIFF ciphers and ODF encryption checksums do not authenticate workbook data; ODF prefix checksums cover only the first 1024 compressed bytes. Mixed AES/Blowfish packages are supported; the callback request identifies `mixed`.
