# DIF and SYLK verification receipt

The TypeScript ESM `ssconvert` engine now installs the `Gnumeric_dif:dif` and
`Gnumeric_sylk:sylk` opener/saver handlers through declarative provider services.
The existing Safe Bash virtual command uses that same engine and injected byte
I/O. Native ssconvert was used only as a separate QA oracle; it is neither a
runtime dependency nor a fallback. No README, push or publication was performed.

## Reference and evidence

The Gnumeric 1.12.61 official archive was authenticated against SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary source was acquired and inspected only below `out`.
The inspected plugin source hashes were:

| Source | SHA-256 |
| --- | --- |
| plugins/dif/dif.c | 373207c4de5ae6a4024e0dff78145319443d8a66e702ed3866c34ed554bc0a86 |
| plugins/sylk/sylk.c | df74c596c16653a592261b74aa0f81f47696228acca23260fd9e603722993aba |
| plugins/sylk/sylk-write.c | e538bbb413fd9cf73bf9ff86125c06a4df43c4ae181861d292c97d1dfe28e0fa |

[Reference profile](dif-sylk-reference-profile.json) captures the executable hash,
version, actual shared dependencies, package versions, plugin inventory,
importer/exporter inventory, locale and timezone. Captures use `LC_ALL=C`,
`LANG=C`, `TZ=UTC`, the built oracle's library/schema/data paths and an in-memory
GSettings backend. The separate oracle runs in the Colima QA container.

[Verification data](dif-sylk-verification.json) retains original fixture bytes,
hashes, expected and actual output bytes, statuses and reference captures.
Early schema setup noise was excluded from the reduced receipt and is not a
diagnostics qualification. Corrected captures use `ID;`
headers and doubled array semicolons. Earlier isolated `ID` captures that selected
CSV are not counted as SYLK passes. Procedures remain in
[the QA plan](../plans/ssconvert-dif-sylk-qa.md).

## Record audit

Both readers use ISO-8859-1 byte mapping, including C1 control bytes, rather than
WHATWG Windows-1252. Import encoding overrides do not alter the plugin's decoding.
The bounded scanner supports LF, CR and CRLF, truncates record text at NUL,
checks cancellation and yields periodically. Record, cell, formula, style-work
and output admission use existing injected limits; no host access is introduced.

| DIF record | Implemented behavior |
| --- | --- |
| Header topics | Consume triples until exact `DATA`; TABLE/VECTORS/TUPLES and unknown header metadata do not establish imported dimensions or sheet name. |
| Type 0 | Require comma; parse C-locale numeric prefix. V creates a number or #NUM! for nonfinite values; TRUE/FALSE create booleans; NA creates #N/A; ERROR warns and leaves a gap; other markers leave gaps. |
| Type 1 | Remove outer paired quotes only; retain interior quotes verbatim. Use text-entry inference, including numbers, booleans, errors, inferred value formats and formulas. Imported formulas retain blank caches until forced recalc. |
| Type -1 | BOT increments row and resets column; EOD terminates and ignores trailer. Unknown control marker warns. |
| Other types / malformed input | Warn in record order, consume associated value record for unknown types, and retain native diagnostic line offsets. Missing header/data records produce the nested DIF read error. |
| Coordinates | Default Gnumeric sheet limits (256 columns, 65536 rows); cells outside the extent are ignored and the source's excess-coordinate warning boundary is represented. Large boundary warning qualification remains unmeasured. |
| Save | Active view sheet; absolute right/bottom dimensions in headers but content begins at the first nonblank row/column, reproducing sparse leading-coordinate shifting. Empty workbook sheet saves a 1x1 blank record. Numbers use six significant digits; #N/A saves NA, other errors ERROR. Strings are raw quoted UTF-8 output, including native lossy reimport through Latin-1. End with EOD. |

| SYLK record | Implemented behavior |
| --- | --- |
| Probe | Exact initial `ID;` bytes; no leading whitespace or BOM normalization. Manual importer selection does not require the signature. Automatic CSV probing declines ID; content even with a .csv filename. |
| ID / NN / B | Preserve released dispatch behavior, including the reversed ID/NN prefix test: ordinary full ID and NN records warn as unknown; short matching prefixes and B records are ignored. NN definitions do not create names. |
| C | X/Y set stateful coordinates (initial B2); K supplies quoted strings, simple numbers, booleans and canonical errors. Duplicate values/formulas warn; later accepted fields win. E parses R1C1 expressions, M plus R/C creates array groups, I retains cached array followers. A comment handler is empty in native; A/G/D/S/N/P/H/T and unknown C fields are ignored. |
| P | P appends formats; E/M/S capture font name, point size and italic/bold flags. F and L are ignored. Unknown fields warn. |
| O | Calculation mode, iteration A/G, A1/R1C1 view conventions, date system V4, protection and hidden zeros. C/D/E/K/R and other V values are ignored. Unknown options warn. Formula parsing remains R1C1 even with O;L. |
| F | Cell/row/column/default styles; numeric formats, general/left/right/center/fill alignment, font name/size, bold/italic, stipple and four borders. N applies global font name/size; M supplies axis size; W supplies column widths. E/G/H/Z set display flags; K ignored. Unhandled options/style codes warn. Whole-axis regions remain bounded metadata. |
| W | Recognized R/A/B/N/S/C window fields are ignored as in released source; other fields warn. |
| E / trailer | E ends input and ignores following records. EOF without E warns and succeeds. Unknown directives warn and continue. |
| Coordinates | 256x65536; invalid coordinates retain prior state. Signed64 decimal strtol range followed by signed32 conversion reproduces wrapped accepted coordinates. |
| Strings / numbers | Double semicolons in any token, without quote-sensitive splitting. Retain raw inner quotes and permit missing closing quote. Decode the released escape/accent table. Simple numeric matching excludes formatted currency/percent/date/grouped numbers and nonzero decimal underflow. |
| Formulas / names | Parse formula tokens through shared SYLK grammar; resolve relative/absolute R1C1, ranges, arrays and known Sheet1 references. Preserve caches until forced recalc. Unknown sheets/external workbook references reject the formula while retaining K. Formula name discovery creates case-deduplicated #NAME? placeholders at their first position, including names discovered in failed/overwritten expressions. |
| Save | Active view sheet; CRLF output, ordered style/format/font declarations, column defaults, per-position styles, axes, B dimensions, O options, sorted C records and E. Formula output uses R1C1, native built-in function spelling, M anchors and I followers. Explicit empty strings affect bounds; style-only regions affect extent. Semicolons double, NUL truncates, non-ASCII string characters become question marks; quotes are not escaped. |

## Verification performed

Before implementation, original in-memory differential regressions failed for
the missing DIF handler and SYLK import/probing behavior. Subsequent validated
repairs each had failing evidence: retained formula caches, inferred value-only
formats, native function spelling, failed-formula name effects, qualified-name
deduplication, General-style formatting, SDK array follower records and misleading
CSV names. Tests use original fixtures and memfs for filesystem effects; they do
not launch native utilities, query models or write fixture files to disk.

The different agent `dif_sylk_stress` independently stressed the built tool,
added 12 regressions and reviewed it again. Its findings led to repairs for style
table admission, native view defaults, escape mapping, simple value matching,
array metadata/caches, style-only bounds, whole-column defaults, explicit empty
strings, wrapped coordinates, decimal underflow and name/value-format handling.
Root retained command integration, exports and Git ownership.

- Final package test: `npm run test --workspace=@poe-code/ssconvert`, 190 files,
  4658 tests passed; the Vitest route executes fresh tests without task-cache reuse.
- Final package lint: `npm run lint --workspace=@poe-code/ssconvert`, passed ESLint,
  source typecheck and test typecheck.
- Cross-workspace build: `npm run build:workspaces --
  --workspace=@poe-platform/safe-bash --no-cache`, passed the maintained selected
  dependency closure (18 builds).
- Scoped Safe Bash command verification: `node --import tsx --test
  --test-concurrency=1 packages/safe-bash/tests/commands/ssconvert.test.ts
  packages/safe-bash/tests/commands/ssconvert-text.test.ts`, 58 tests passed.
  This is a focused command check, not the complete Safe Bash or repository gate.
  Includes shared SDK bytes/diagnostics, malformed status, unchanged destination,
  file effects and checkpoint replay; existing command checks cover cancellation.
- Native direct output: 37/38 byte comparisons matched. All 38 candidate
  conversions succeeded. The only difference is the styles.slk SYLK table order.
- Native reopen/cross-format comparison: 50/50 bytes matched, comprising 44
  DIF/SYLK reopen imports and six native XLSX-to-DIF/SYLK exports. The 22 candidate
  exports were reopened again with native after the final product edits; all
  succeeded. Native XLSX conversion captures are retained separately in the data.
- The built virtual CLI was captured and visually inspected with
  `npm run screenshot -- -o out/ssconvert-dif-sylk/visual.png node
  out/ssconvert-dif-sylk/visual.mjs`: DIF retained cached 99, forced recalculation
  produced CSV `4,5`, both exited zero and warnings remained visible. The receipt
  retains the inspected image hash; temporary capture was purged after reduction.

## Remaining differences and unmeasured coverage

Exact parity is not claimed. The bordered Arial style fixture has different
format/font table enumeration and corresponding indices, although represented
styles and values round-trip. Native `src/mstyle.c` uses a nonsymmetric numeric
comparison macro returning -1 for both directions, and enumeration depends on
native style hash/list order. There is no validated general ordering repair.
Most-common-style ties have not been differentially qualified.

Automatic ID; detection for misleading .csv names deliberately differs from the
reference: native's filename probe selects CSV. The user explicitly requires
SYLK content to avoid CSV fallback. Explicit CSV importer selection still works.
Isolated `ID` is not automatically probed as SYLK, matching the plugin signature.

Stable warning messages and order are retained, but native GLib stderr wrappers
include process IDs/timestamps that are not reproduced. Raw complete stderr byte
identity is therefore not a pass. Oversized/malformed records that trigger native
critical logs, every limit boundary, every locale/codepage combination, every
formula/function/external-name grammar case, style colors and arbitrary foreign
metadata remain unmeasured. Unsupported styles and shared-value/table/comment
fields ignored by the released plugin are not advertised as implemented features.

Safe Bash's maintained typecheck exited 2 before checking current consumer groups:
`Public SafeFS must preserve shared SafeJS runtime identity`, actual undefined,
expected `./packages/safe-js/dist/safe-fs.js`. The prerequisite concerns the current
root export surface; it was recorded without altering unrelated existing edits.
No full repository lint/test, complete export-consumer gate or release was verified.
There are no local commits, remote delivery or publication for this task.
