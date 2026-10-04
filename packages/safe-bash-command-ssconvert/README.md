# Spreadsheet conversion

`createSsconvertCommand(options?)` creates one command, `createSsconvertCommands(options?)` returns its family, and `ssconvertCommands(options?)` registers a shell plugin. `SsconvertCommandsOptions` accepts optional codecs and host bindings; omitted environment settings use the C locale and UTC. All factories accept no arguments. JPEG graph export uses typed arrays and works without Node globals.

Convert spreadsheets through the `poe-code/ssconvert` SDK on Node.js 22 or newer.
`ssconvertCommands()`, `createSsconvertCommands()` and `createSsconvertCommand()`
register shell commands without options, using the built-in format registry and
a C/UTC environment. Supplied codecs and environment bindings override those defaults.
The engine provides spreadsheet import and export, recalculation, workbook updates,
and chart and print rendering. Large-argument `BESSELJ`/`BESSELY` retain the source phase algorithm and report its reduced-accuracy warnings; these results do not promise correct rounding across native math libraries. SDK `rewriteReferences` with `translation: "move"` preserves referenced cells when a formula moves between sheets and retains unchanged A1 reference spelling. With workbook context, parse and rewrite positions accept sheet IDs or case-insensitive display names; IDs take precedence when the two collide. Rewrite sheet-renaming maps accept display names, falling back to captured sheet IDs. OpenFormula input (`of:=[Second.A1]`) retains relative sheet targets; `$Second` fixes the sheet independently of cell axes. SDK copy translation uses workbook tab order. CLI `--set` and SDK text updates accept `of:=` expressions. ODF preserves these markers directly; XML/XLSX retain the original expression and named-expression anchor in ssconvert annotations, with fixed-target formulas for readers that ignore them. BIFF7/8 export resolves relative sheet references at the formula or name declaration anchor and warns that fixed sheet targets can change cross-sheet copy and named-expression results. Conversion evaluates queued formulas on load before applying updates, including dirty formulas in manual mode; `--recalc` then forces a separate evaluation. `readWorkbook` remains a raw import. PDF headers and footers honor enabled XLSX and Gnumeric first-page numbers from 0 through 4294967295, continue display numbering on automatic sheets, and use physical page counts for total-page fields. PDF export applies persisted manual and data-slice row/column page breaks and recomputes stored automatic breaks. XLSX row and column breaks retain their axes through XML/XLSX/BIFF conversion; untouched XLSX break bounds and flags survive export, while normalized edits take precedence. Lotus WK1/WK3 named-range records import as workbook names; WK3 formula tokens resolve declarations case-insensitively and retain their original live name with a per-use relative or absolute copy mode. Definition edits and deletion affect recalculation, and copying preserves local versus explicitly qualified sheet targets. Missing names initially evaluate to `#NAME?` and bind when their global definition is added, including after a copy. Native XML/XLSX/BIFF export of these live tokens remains unsupported and reports an error instead of dropping the name identity or copy mode. Lotus STYLE sheet names decode LMBCS, including Unicode escapes and Japanese, Korean and Chinese groups. Single-byte groups preserve Hebrew, Arabic, Cyrillic, Turkish and Thai characters, including euro updates and assigned fi/fl ligatures, following ICU mappings beyond Gnumeric's historical tables. Lotus INDEX imports select from fixed sheet spans, including 256-sheet ranges. Modern direct references preserve sheet relativity independently of row and column flags, including relative owner-sheet endpoints in cross-sheet ranges. WK3 external variables such as `<<book.wk3>>Sheet:A1` and `<<book.wk3>>First:A1..Last:B2` retain their workbook and sheet identities; recalculation requires the explicit `externalReferences` host binding and otherwise returns `#REF!`. The optional `pythonSampleFunctions` binding adds
percent formatting through `PY_PRINTF` and Unicode 16 capitalization through `PY_CAPWORDS`; supply it as `runtimeFunctions` to enable
the sample functions. `perlSampleFunctions` retains the Perl 5.34.1 profile. Use `createPerlSampleFunctions({ version: "5.40.1" })` for boundary-checked variable lookbehind and failed-branch capture clearing, or `"5.34.1"` for the default behavior. Both Perl profiles support `\K` to preserve a matched prefix during substitution, including native repetition backtracking; resets inside lookarounds remain refused. Experimental lookbehind emits version-specific `perl-regex` warnings; consecutive identical patterns share compilation warnings within a conversion, while separate conversions remain independent. Warnings use portable messages without native regex-location markers or machine-specific script paths. Perl 5.40 atomic-lookbehind state defects remain a native qualification limitation. Use `createPythonSampleFunctions({ unicodeVersion: "15.0.0" })` for Unicode 15.0 capitalization and printable-character rules in percent formatting, or `"15.1.0"` for the CPython 3.13 Unicode profile; `"16.0.0"` selects the default profile. `PY_BITAND` delegates to the spreadsheet bitwise function; invalid bit domains return an empty cell with the native Python bridge warning. `PY_CAPWORDS` stops at the first NUL and refuses malformed visible Unicode.
Cooperative `runtimeFunctions` ports can return scalar values, rectangular matrices,
and references to invocation-owned sheets; arrays are copied and bounded, and returned
references retain their dependencies.
`isSsconvertError(error)` recognizes typed failures across the separately bundled SDK and Shell exports.
The optional `perlSampleFunctions` binding adds clock-based dates
and bounded pattern substitution with literal replacements. Date formulas use pinned tzdb 2026c offsets for 485 named zones and aliases, including historical local time and future daylight-saving rules; names outside that profile retain host Intl behavior. Native byte results
use an explicit `byte-string` value with lowercase hex, preserving invalid UTF-8
through qualified text formulas, arrays and CSV output. LOWER/UPPER use captured
Unicode 16 C-locale case behavior, including native byte values. CLEAN, PROPER, REPT, REPLACE/REPLACEB, SUBSTITUTE, FIND/FINDB, SEARCH/SEARCHB and LENB/LEFTB/RIGHTB/MIDB
also accept native byte values. Wider Perl grammar,
diagnostics and byte consumers remain documented gaps. It also opens XOR-obfuscated and RC4-encrypted Excel workbooks (standard and CryptoAPI)
using the native reader's built-in password or an explicit host `password.read` callback. AES/Blowfish-encrypted OpenDocument spreadsheets open through the same host callback. Encrypted Paradox tables open automatically using their declared header key. The optional `createDatabaseFunctions(query)` binding runs EXECSQL/READDBTABLE through an explicit cooperative host query port, with read-only requests and bounded owned recordsets. Numeric results may include `format`, such as `{ kind: "number", value: 45292, format: "yyyy-mm-dd" }`, to preserve dates in formulas and exports. Public `recalculateWorkbook` returns a promise and yields between work quanta, as does `runSolver`, so timer-driven cancellation works even with a frozen host clock. `recalculateWorkbookSync` is available for numerical callbacks that require an immediate result. Formula parsing, dependency traversal and retained object ownership use configured budgets rather than implicit depth ceilings. Resource limits default to `Infinity`; pass a partial `limits` object to opt into finite nonnegative safe-integer ceilings. Formula parsing and evaluation use `formulaDepth` and `formulaDependencyDepth`; `patternDepth`, `objectDepth`, `workbookDepth` and `outputSymlinks` bound pattern nesting, object projection, ownership copies and publication aliases. Direct `parseExpression` callers can set `maximumDepth`, `maximumLength` and `maximumNodes`. Format support has documented limits; see the
[usage guide](../../docs/ssconvert/usage-draft.md) for examples and capabilities.

```ts
import { createEngine } from "poe-code/ssconvert/core";
import { csvFormat } from "poe-code/ssconvert/formats/csv";
import { xlsxFormat } from "poe-code/ssconvert/formats/xlsx";

const engine = createEngine({
  formats: [csvFormat, xlsxFormat],
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

Choose `csvFormat` (CSV/TSV), `xlsxFormat`, `odsFormat`, `xlsFormat`,
`spreadsheetmlFormat`, `htmlFormat` or `dbfFormat` with `formats`. The `/core` entrypoint registers no formats
by default; import each chosen format from its `/formats/` subpath to keep other
readers, writers and renderers out of your bundle. The core, CSV, XLSX, ODS, XLS, SpreadsheetML, HTML and DBF subpaths are also available
under `@poe-platform/safe-bash/ssconvert`. Use `poe-code/safe-bash/spreadsheet-ast`
(or `@poe-platform/safe-bash/spreadsheet-ast`) for the workbook model alone.

The compatibility `poe-code/ssconvert` entrypoint retains all built-in formats
when `formats` is omitted. Use `formats: []` for custom codecs only.
For a shell with selected formats, import `createSsconvertCommand`,
`createSsconvertCommands` or `ssconvertCommands` from `/commands`:

```ts
import { ssconvertCommands } from "poe-code/ssconvert/commands";
import { csvFormat } from "poe-code/ssconvert/formats/csv";

const plugin = ssconvertCommands({ formats: [csvFormat] });
```

Gnumeric XML and gzip imports read retained file ranges and decode in bounded
chunks, including UTF-8, UTF-16 and supported legacy single-byte encodings.
XML trees and workbook values remain resident; this is not yet a fully bounded
large-workbook conversion path.

These commands register only the selected formats. Their VFS, cancellation,
resource limits and output publication use the same shell adapter as the
compatibility commands. Omitting `formats` from a composable command installs no formats. The same API is
available at `@poe-platform/safe-bash/ssconvert/commands`.
The compatibility entrypoint also supplies default rendering and clipboard
capabilities; `/core` requires those capabilities explicitly.
Repeated XML row/column sections and overlapping records apply in file order,
including changes to sheet defaults. Cells retain dimensions allocated before
a later default change. Zero-size
records retain prior or default dimensions while applying their other metadata.
Records with missing or malformed sizes, or sizes at or below -1, are skipped
with a corruption warning. XML exports reject nonpositive, malformed, or
rounding-overflow dimensions instead of silently changing workbook geometry.
Nonpositive sheet defaults retain built-in dimensions. Clipboard
exports preserve collapsed flags and outline depth. Gnumeric workbook
and clipboard XML store row and column dimensions in points with four significant
digits of precision, including inherited sheet defaults. XLSX imports retain
fixed/automatic sizing, including best-fit column overrides, through XML,
clipboard and both XLSX editions. Repeated XLSX column records preserve earlier
accepted dimensions and outlines, including adjacent collapsed summary markers
for hidden groups. Repeated rows preserve accepted heights and hidden state;
explicit outline resets and zero-level summary rows survive re-export.
Late XLSX defaults preserve allocated row heights and automatic sizing; empty
rows use the final default. Repeated default-format records combine on export.
Rejected XLSX dimensions retain prior/default sizes;
direct SDK exports still refuse unrepresentable dimensions.

Filesystem and network access require explicit host bindings. The engine never
uses a native spreadsheet converter as a fallback. PDF exports can use an explicit
`fonts.resolve({ family, bold, italic, maxBytes, signal })` host binding returning
TrueType font bytes, which the engine copies. The default request is Sans, regular; missing supplied
fonts refuse without substitution. With no binding, the packaged JetBrains Mono
font remains the default. PDF export uses JavaScript fontkit shaping when the runtime
cannot compile WebAssembly (including Cloudflare Workers). Font bytes and character-map work are bounded before parsing.
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
merges and text layouts retain explicit refusals. BIFF7/8 imports preserve external
workbook, sheet, cell/range and defined-name identities, cached values and raw link records.
Recalculation uses the explicit `externalReferences` host binding and otherwise
returns `#REF!`; linked workbooks are never fetched automatically. External names
retain their workbook or sheet scope without taking values from local names or
on-file external-name expressions. BIFF8 and XLSX conversions preserve imported external sheet order and absolute cell/area and error definitions for external names without evaluating them. XLSX and BIFF8 external spans require both endpoints in the retained sheet order. BIFF8 export refuses retained definitions it cannot represent; relative BIFF definitions remain native-only. BIFF2 import reads compact named and optimized-reference formulas, array constants and array-formula records. BIFF2–4 imports recognize original fixed-argument forms of FIXED, TRUNC, WEEKDAY, HLOOKUP, VLOOKUP and DAYS360. BIFF8 deleted natural-language label tokens import as `#NAME?` expressions using Calc error semantics; supported live label forms retain their identity as described below. BIFF2–8 data tables import through TABLE recalculation, and BIFF7/8 export uses native data-table records. Deleted BIFF8 inputs round-trip as `TABLE(#REF!,…)` and recalculate to `#REF!`; BIFF7 and dual-stream export refuse them. This explicit error marker extends Gnumeric TABLE, which treats non-reference inputs as omitted. BIFF7/8 exports preserve these external identities, including references in defined names and array formulas. BIFF7 refuses external multi-sheet ranges and identities that its Windows-1252 link records cannot represent.
Missing local sheet targets export as deleted references (`#REF!`) without creating a replacement sheet. BIFF7/8 exports resolve sheet references without regard to case and preserve the exact spelling and scope of defined names. Relative row references wrap at the format's row limit: 16,384 before BIFF8 and 65,536 in BIFF8. BIFF imports and exports preserve standard document properties and named custom scalar properties through `Workbook.properties`, including Unicode text, keywords and timestamps. Uninterpreted property data from new imports survives reexport alongside edits and deletions of known fields, with original codepages and timestamp precision preserved. Added custom names must fit the original dictionary encoding; ambiguous edits and unrepresentable metadata produce explicit warnings. BIFF encryption leaves document properties plaintext unless a CryptoAPI `-properties` profile is selected. CryptoAPI imports decrypt encrypted property containers using the same host password; unknown ancillary streams are retained with diagnostics.
BIFF7/8 imports and exports preserve sheet scroll positions and frozen rows and columns. Unfrozen split panes retain export loss warnings. BIFF7/8 and XLSX retain print headings, gridlines, centering and fit-to-page limits, including an unrestricted width or height. Stored first-page numbers and their enable flags survive XLSX/BIFF7/8 conversion independently. PDF headers honor automatic or explicit numbering; print copy counts do not duplicate PDF pages. BIFF solid fills preserve their foreground/background color roles across import and export. Excel fill patterns map to the shared style model; six additional Gnumeric patterns use the native exporter’s closest Excel pattern. BIFF7/8 cells with supported Sans styles can print to PDF; left-aligned text spans empty columns and clips before occupied cells. Unsupported style effects, multiline text and other overflowing alignments still report explicit errors. XLSX exports declare the built-in Normal style so readers can use the exported default formatting. New XLSX sheets keep the same default column width after re-import, correcting Gnumeric 1.12.61's mixed-unit default declaration. Gnumeric XML writes print margins at native four-significant-digit precision while the workbook model retains full precision. XLSX re-export retains worksheet properties, default dimensions, protection flags and hashes, precise print settings, and all odd/even/first-page headers and footers. Explicit normalized edits update the corresponding settings; unsupported fields and printer relationships still report loss. XLSX shared, inline and cached formula strings, plus external sheet names and normalized headers and footers, preserve control characters and literal `_xNNNN_` sequences. Missing inline-string payloads stay blank, while explicit empty payloads remain empty strings. Empty formula string caches stay distinct from missing values; formula text is not escape-decoded. BIFF8 preserves printed comment placement and error-display settings; BIFF7 warns when it must use in-place comments or display errors unchanged. BIFF7/8 literal arrays retain their stored value types during recalculation. SDK cell, name and formula-group records can set `arrayStringLiterals: true` to preserve strings such as `"001"`, `"TRUE"` and `"#REF!"`. XML/XLSX exports carry an ignorable annotation for ssconvert readback; native Gnumeric's text import still coerces those strings.
Safe Bash provides a separate,
opt-in `ssconvertCommands` plugin using the same engine. Import it from
`poe-code/ssconvert` or `poe-code/safe-bash`. `ssconvertCommands()`,
`createSsconvertCommands()`, `createSsconvertCommand()` and SDK `createEngine()` use the built-in formats with locale `C` and
timezone `UTC`; options can add codecs, capabilities and resource limits. Injected locale settings also accept `en_US`, `en_US.UTF-8` and `en_US.utf8`. When a text converter's charset is empty, bare `en_US` selects ISO-8859-1 and the UTF-8 variants select UTF-8. Formula source length, node count and quoted-label lookup work default to `Infinity`; callers can set `maximumLength` and `maximumNodes` when parsing formulas.
It verifies logical `PWD` aliases through the supplied filesystem before using
them for resource paths and diagnostics. SDK hosts can call
`resolveVfsCwd(actualCwd, env.PWD, filesystem, signal)` and bind the result with
`createResourceIO({ cwd, filesystem })`. Unknown identity keeps the actual cwd;
the exported `PWD` value stays available to formulas unchanged.
The optional `datasource` binding enables `ATL_LAST(tag)` through an owned host
transport. Each operation opens a separate session; successful default solver
processing polls one finite available byte batch and closes the transport after
the operation. Custom solvers can process additional batches through
`context.datasource.poll(book)`. Supply `tag:number\n` byte records; partial
records carry across batches. Transport acquisition and OS timing belong to the
host binding.

Configurable text export (`Gnumeric_stf:stf_assistant`) remembers a text input's
unique LF, CRLF or CR terminator unless an explicit `eol` option overrides it;
plain CSV export continues to use LF. Text import and both CSV exporters preserve
embedded NUL characters, including delimiters and quotes that follow them. This
extends native behavior: Gnumeric substitutes spaces on import and truncates
exported fields at NUL; LibreOffice strips NUL on CSV import.

SYLK export preserves explicit cell and column formats. CSV text-entry formats
(such as inferred times and month/day/year dates) export as General, matching
Gnumeric; their numeric values and imported display formats remain intact.
Set a cell's `format` and clear `inferredValueFormat` to make that format explicit.

This workspace is private and is distributed through the `poe-code` SDK subpath.

BIFF8 preserves declared label ranges in each sheet's ordered `labelRanges`
bindings (`axis`, `labels`, `data`) and the workbook's `automaticLabelLookup`
setting. Inferred data ranges use the BIFF8 grid (65,536 rows, 256 columns).
BIFF8 cannot store finite data endpoints produced by shrinking that grid; exporting
those bindings is rejected rather than silently expanding them. Use ODF to retain
explicit data endpoints.
Overlaps and multi-column row labels retain their original order and extent.
ODF and legacy OpenOffice imports read native same-sheet label/data declarations;
ODF exports preserve their order, explicit endpoints and automatic lookup setting.
ODF defaults automatic lookup to enabled when the setting is absent. Native quoted
labels such as `SUM('Sales')` bind after all sheets load, using declared ranges
first and enabled automatic lookup on the formula's sheet. Array and named
expressions use the same binding. The internal `@column.odf.quoted:A$1` form keeps
the cell anchor and OpenFormula range rules through edits: aggregates stop at a
gap after skipping at most one initial blank and exclude the formula cell itself;
scalar consumers use the formula position and reject a self-reference. BIFF labels retain Calc's data-area expansion. OpenFormula `!!`
intersects one row label and one column label, retaining both live anchors;
it returns an error unless their data ranges intersect in exactly one cell.
Both ODF writers export these live OpenFormula labels using the current label
text, including `!!`, arrays and named expressions. Export verifies that the text
still selects the same anchor, orientation and relative coordinates. Formula-generated
labels retain their cell anchor and refresh dirty results according to calculation
mode. Labels can coexist with relative-sheet references in the same expression.
Ambiguous, deleted and non-text labels and BIFF-specific label semantics remain
unsupported in ODF output. Declared label
ranges can read data on another sheet through import, recalculation, edits and ODF
export. SDK `LabelRange.dataSheet` is the stable data-sheet ID; omission uses the
label's sheet. Native application qualification remains open.
ODF hyperlinks to sheet-local names use Calc's `Total (Sheet)` destination
syntax, including in unchanged rich-text paragraphs, and retain the named target through link-text edits; global names remain
unqualified. Native application navigation is not yet qualified.
BIFF7 and data endpoints that BIFF8 cannot encode are refused; the public engine
warns when other exporters omit this metadata. Live BIFF8 row/column label tokens
(`02`, `03`, `06`, `07`) recalculate and reexport with their anchor, reference
class, quoting and relative/absolute flags preserved. The internal spellings
`=@row:A1` and `=SUM(@column.value.quoted:$A$1)` retain the label cell; scalar uses select a cell at the
formula position, while automatic aggregate uses follow the contiguous data
area. Copies, shared/array evaluation and edits retain that behavior. BIFF uses
one relative flag for both coordinates: `A1` moves with a copy, `$A$1` stays
fixed, and mixed addressing such as `$A1` cannot be exported as a BIFF label. These are
ssconvert expressions, not native Gnumeric text syntax. BIFF7, BIFF named-expression
export, and other formula formats refuse live BIFF labels until their transport is
implemented. Explicit BIFF8 radical labels (`0A`) preserve their following data
area, including gaps, independent endpoint addressing and reference/value/array
class. For example, `=SUM(@range:$A$1->$B$1:$D$1)` sums exactly B1:D1;
`->#REF!` retains a label whose data area was deleted. Copies, moves, sheet edits
and recalculation track both the anchor and explicit area. Multiple-cell radical
labels (`0B`) also retain their ordered members, for example
`=SUM(@range.multi:{$C$10;$A$1}->$A$2:$A$4)`. Their shared relative/absolute
flag applies to every member; the final member adjoins the data column.
Inferred multiple-cell labels and native application qualification remain open.

For encrypted BIFF imports, `createEngine({ ...config, password: { read: readWorkbookPassword } })` asks only after the built-in password fails. The callback receives the algorithm, revision, input filename when available, encoding, maximum byte length and invocation cancellation signal. Return a string or UTF-16LE bytes for RC4 (up to 255 UTF-16 code units); XOR requires explicitly encoded bytes (0–15). Return `undefined` to decline. Passwords never come from command arguments or guest environment variables, and callback failures produce a sanitized diagnostic. OpenDocument AES-CBC and Blowfish-CFB8/CFB64 imports accept UTF-8 strings or bytes through this callback, supporting AES128/192/256 and Blowfish4–56-byte keys, SHA1/SHA256 start keys and prefix/full checksums. The callback runs once after every encrypted member is admitted; malformed Unicode is rejected. Blowfish imports also recognize LibreOffice’s eight-byte CFB64 feedback using the checksum, with both attempts admitted before password access; the existing import callback identifier remains `blowfish-cfb8` because the on-file algorithm name is shared. Both the `PBKDF2` name and its standard ODF URI are accepted. All encrypted members are verified before conversion. Exports remain plaintext unless explicitly requested with `exportOptions: ["encryption=odf12-aes256-cbc"]` (CLI: `-O encryption=odf12-aes256-cbc`). Both ODF writers also accept `encryption=odf12-aes128-cbc` and `encryption=odf12-aes192-cbc`. These legacy ODF 1.2 profiles use the selected AES key size, CBC mode, SHA256 start keys, PBKDF2-HMAC-SHA1 with 1024 iterations, and SHA256 prefix checksums. For explicit eight-bit Blowfish-CFB8 output, `encryption=odf12-blowfish-cfb8` uses a 16-byte key, SHA1 start keys and prefix checksums, and the same 1024-round derivation. For LibreOffice-compatible eight-byte CFB64 output, select `encryption=odf12-blowfish-cfb64`; its password request identifies `blowfish-cfb64`, and it uses the same key, digest and derivation profile. Export requires `password.read` and a trusted `entropy.read({ length, signal })` callback that supplies fresh cryptographically random bytes of exactly the requested length. The password request has `purpose: "encrypt"` and the output filename when available; existing import requests are unchanged. Salt and IV are fresh per member; AES padding uses fresh bytes as well. Content, styles, settings, metadata and embedded resources are encrypted; mimetype and manifest remain readable. Statistical `random.next` is never used for encryption. BIFF ciphers and ODF encryption checksums do not authenticate workbook data; ODF prefix checksums cover only the first 1024 compressed bytes. Mixed AES/Blowfish packages are supported; the callback request identifies `mixed`.

BIFF8 (`Gnumeric_Excel:excel_biff8`) accepts `exportOptions: ["encryption=rc4"]` (CLI: `-O encryption=rc4`) for standard 40-bit RC4, or `encryption=rc4-cryptoapi-128` for CryptoAPI RC4. CryptoAPI supports key sizes 40–128 in 8-bit steps. Append `-properties` (for example, `encryption=rc4-cryptoapi-128-properties`) to encrypt document properties in the separate CryptoAPI container using that same password and entropy request. The plaintext summary is omitted and the document-summary stream contains only an empty placeholder. Without this suffix, document properties remain plaintext. These profiles also preserve opaque ancillary streams retained on import. Duplicate stream names or malformed retained bytes are refused. Other profiles still warn when dropping unknown ancillary streams. These are explicit legacy compatibility profiles without data authentication. Both require host `password.read` and `entropy.read`; the password request identifies `purpose: "encrypt"`, `format: "biff"`, `algorithm: "rc4"` or `"rc4-cryptoapi"`, revision 8 and UTF-16LE encoding. Strings or bytes can contain up to 255 UTF-16 code units, including an empty password. Each export requests 32 fresh random bytes for its salt and verifier. CryptoAPI uses SHA-1 derivation and a 20-byte verifier hash; it does not load a host cryptographic provider. Record headers and required framing fields remain readable; workbook contents are encrypted. BIFF7, BIFF8 and dual-stream exporters also accept `encryption=xor`, requiring 1–15 explicitly encoded password bytes and no entropy. Dual-stream export obfuscates both streams with one password request (revision 8). XOR provides no security. Empty-password export is refused because key derivation is undefined; empty-password import remains supported. Plaintext stays the default. Calc 25.2 interoperability is limited to XOR, standard RC4 and 128-bit CryptoAPI; it drops encrypted document properties and refuses embedded-NUL passwords. Apache POI 5.4.1 independently reads all advertised CryptoAPI key sizes and encrypted properties, including NUL-password controls.

LibreOffice’s default encrypted-package imports use Argon2id v19 and AES256-GCM. Both ODF writers can export this profile with `exportOptions: ["encryption=libreoffice-aes256-gcm"]` (CLI: `-O encryption=libreoffice-aes256-gcm`), using the explicit password and cryptographic entropy callbacks. The password request identifies `algorithm: "aes-gcm"` and `revision: "libreoffice"`, with `purpose: "encrypt"` for export. The writer uses three passes, 64 MiB and four lanes, with a fresh 16-byte salt and 12-byte IV per package. Allow `limits.workbookWork: 256 * 1024 * 1024`; `limits.encryptionMemoryBytes` defaults to `Infinity` and bounds the Argon2 arena separately. The GCM tag authenticates the complete inner ZIP before decompression. Outer/inner ZIP and XML processing share work and member limits. Cancellation drains the admitted Argon2 computation so its secret arena is cleared before returning. Use a non-empty password for LibreOffice interoperability: the 25.2 and 26.8 loaders refused empty passwords, although independent crypto verification and SDK readback passed. Calc 25.2 independently opens and recalculates AES128/192/256-CBC, Blowfish-CFB64 and AES256-GCM exports with ASCII, Unicode and embedded-NUL passwords; it refuses CFB8 output. Select CFB64 when sharing legacy Blowfish files with Calc.

Paradox (`Gnumeric_paradox:paradox`) accepts `exportOptions: ["encryption=paradox"]` (CLI: `-O encryption=paradox`). The host `password.read` request identifies `format: "paradox"`, `algorithm: "paradox"`, revision 12, `purpose: "encrypt"` and byte encoding. Return 1–256 explicitly encoded bytes; native NUL termination applies, and empty effective passwords are refused. No entropy is needed. This legacy obfuscation leaves a recoverable key and readable schema in the file, providing no password security or data authentication. Imports need no password callback; plaintext remains the default.

The workspace entrypoint exports `ssconvertCommands()` for plugin registration,
`createSsconvertCommands()` for the command collection, and
`createSsconvertCommand()` for a single command. Each accepts an optional
`SsconvertCommandsOptions` object; existing factory names remain available.
The command supports streaming and buffered virtual filesystems and honors
`limits.inputBytes` on both paths. CSV/text and custom range readers use retained file handles
where available; stdin and other sequential sources use the invocation’s safe-fs
for staging. Configure `workingFiles: { directory, cacheBytes }` on the command
factory to select a staging directory and a cache size in 16 KiB multiples
(default 1 MiB). Other built-in importers and workbook models still buffer; an external
safe-fs backend is needed for staging without retaining its contents in RAM.
XLSX exporters use working storage to stage ZIP member payloads and central
records. XML encoding, member compression and archive output use bounded chunks;
worksheet rows use caller-backed staging, and row, worksheet and shared-string
XML containers stream. Shared-string counts, IDs and XML use caller-backed
storage, as do ordered cell-coordinate indexes. Style-region blanks are generated
during traversal. Scalar CSV/text inputs replay into either XLSX edition or ODF profile without
full cell arrays; formula inputs and global transformations retain the workbook path.
Individual strings, other workbook cells, style indexes and other
metadata still reside in memory. ODF exporters also stage compressed members and
central records through working storage and stream unencrypted member encoding,
compression and archive output. Rows, tables and the document body stream through
caller-backed staging before styles are serialized. Generated ODF cell-style keys,
reserved names and XML use working storage, and the automatic-styles container
streams. Individual cell strings, retained style definitions and other metadata
XML, embedded resources and encryption buffers remain resident.
Gnumeric XML and gzip imports use caller storage for scalar cell replay when
working storage is configured, preserving duplicate coordinates, styles and metadata.
Formula-bearing inputs use the workbook reader. Gnumeric XML and gzip exports
stream encoded output with backpressure. CSV/text
conversions without global evaluation replay cells from retained input, including
styles and sheet extents, without building full cell arrays. With working storage
configured, unordered-cell export uses bounded merge runs in the caller’s safe-fs.
Other workbook paths, individual fields, and retained metadata still use in-memory
representations; this is not complete bounded-memory conversion.

Gnome Glossary PO output filenames select the translation column: `fr.po` selects
`fr`, while `..po` selects `..po`. Timestamps use the injected `clock.now()` and explicit
`environment.timezone`, with native TZif abbreviations such as `PST`/`PDT`
and `+0545`. All 485 zones and aliases captured in the pinned Debian tzdb 2026c
profile support historical and future dates throughout the JavaScript Date range.
Uncaptured names return `capability-denied`; invalid clocks return `invalid-request`.
Header parity does not qualify the full native Python glossary plugin.
