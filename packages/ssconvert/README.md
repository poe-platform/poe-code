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
uses a native spreadsheet converter as a fallback. PDF exports can use an explicit
`fonts.resolve({ family, bold, italic, maxBytes, signal })` host binding returning
TrueType font bytes, which the engine copies. The default request is Sans, regular; missing supplied
fonts refuse without substitution. With no binding, the packaged JetBrains Mono
font remains the default. Font bytes and character-map work are bounded before parsing.
PDF export retains styled cells' logical text for copying and extraction,
including combining marks whose glyph positions differ from their text order.
Styled Latin, Greek and Cyrillic text uses font-supported canonical composition;
missing intermediate or final glyphs retain the supported decomposition.
With explicit fonts, it also admits fully materialized Gnumeric Sans styles for blank cells
and single-line values that fit the selected font and cell: General or explicit
left/right/center alignment, regular or bold, sizes
8/10/14, black or red text, and solid white or yellow backgrounds. Font selections
share one invocation byte budget. This profile uses the captured native 96-DPI
scale and print insets, so size 10 paints at 7.5 points. Cell alignment, fit and glyph placement
use shaped advances and offsets. Exact native rendering remains unqualified. Other styles,
merges and text layouts retain explicit refusals. BIFF8 external cell and area
links calculate to `#REF!`; their cached values and raw link records remain retained,
and linked workbooks are never fetched. External names use supported on-file
declarations during recalculation; missing or inactive names produce `#REF!`,
while a declaration can supply the expression for a linked workbook name placeholder.
BIFF7/8 exports preserve case-insensitive sheet references and sheet-local names.
Safe Bash provides a separate,
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

For encrypted BIFF imports, `createEngine({ ...config, password: { read: readWorkbookPassword } })` asks only after the built-in password fails. The callback receives the algorithm, revision, input filename when available, encoding, maximum byte length and invocation cancellation signal. Return a string or UTF-16LE bytes for RC4 (up to 255 UTF-16 code units); XOR requires explicitly encoded bytes (0–15). Return `undefined` to decline. Passwords never come from command arguments or guest environment variables, and callback failures produce a sanitized diagnostic. OpenDocument AES-CBC and Blowfish-CFB8 imports accept UTF-8 strings or bytes through this callback, supporting AES128/192/256 and Blowfish4–56-byte keys, SHA1/SHA256 start keys and prefix/full checksums. The callback runs once after every encrypted member is admitted; malformed Unicode is rejected. All encrypted members are verified before conversion. Exports remain plaintext unless explicitly requested with `exportOptions: ["encryption=odf12-aes256-cbc"]` (CLI: `-O encryption=odf12-aes256-cbc`). Both ODF writers support this legacy ODF 1.2 profile: AES256-CBC, SHA256 start keys, PBKDF2-HMAC-SHA1 with 1024 iterations, and SHA256 prefix checksums. Export requires `password.read` and a trusted `entropy.read({ length, signal })` callback that supplies fresh cryptographically random bytes of exactly the requested length. The password request has `purpose: "encrypt"` and the output filename when available; existing import requests are unchanged. Salt, IV and padding are fresh per member. Content, styles, settings, metadata and embedded resources are encrypted; mimetype and manifest remain readable. Statistical `random.next` is never used for encryption. BIFF ciphers and ODF encryption checksums do not authenticate workbook data; ODF prefix checksums cover only the first 1024 compressed bytes. Mixed AES/Blowfish packages are supported; the callback request identifies `mixed`.
