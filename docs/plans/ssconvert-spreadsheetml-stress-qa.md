# Independent SpreadsheetML stress QA

Current additional independent review (2026-09-20) established a failing
interleaved Table regression and repaired Row/Column event order and the shared
column cursor using the authenticated upstream event handlers. Four new original
in-memory cases include sparse/merge cursor reset, unknown-node ordering and a
foreign-namespace negative control. All 49 importer cases, focused ESLint and
the test TypeScript project pass. This resolves the earlier Columns-before-Rows
gap; cross-region style overwrite semantics and arbitrary attribute warning
order remain unverified. No native oracle was executed by the reviewer. Root's
current verification addendum records final package/integration gates and the
unavailable fresh native matrix separately. Historical findings below retain
their original point-in-time coverage.

## Procedure

1. Inspect authenticated Gnumeric 1.12.61 `plugins/excel/excel-xml-read.c` under `out/ssconvert-lifecycle`; keep native tooling an external oracle.
2. Execute original in-memory cases through the importer and the maintained SDK memfs cases. Unit cases must not spawn native tools or write fixture/output files.
3. For each discovered defect, run its new test to establish failure, repair the importer, and rerun focused tests and lint/type checks.
4. Root executes uncached maintained cross-workspace verification and captures native dependency/plugin/locale evidence; inspect native captures under `out/spreadsheetml` without treating unsupported/unmeasured cases as passes.

## Verified review coverage

The independent stress test file contains twenty-five passing cases, including the final sheet-name quoting regression: malformed XML failure; namespace/content probing; cancellation before probing and after awaited warnings; input/cell/XML-node/axis allocation limits; row/merge coordinate limits; selection/filter coordinate limits and shared workbook-work admission; style-only cells and allocation charging; numeric Boolean fallbacks; decimal-prefix/nonfinite number behavior; sparse indexed formula destinations; sequential style/name definitions and native named-range diagnostic bodies.

Concrete failing regressions preceded repairs for invalid-Boolean warnings, Boolean numeric fallback and nonfinite numbers, indexed relative formula serialization, document-order styles/names, named-range diagnostic bodies, style-only cells, row/merge bounds, metadata coordinate bounds and shared workbook-work accounting. Root's failing exporter regression established the need for Gnumeric style metadata, including attribute namespaces, colors, enum alignment, font and borders. Root's regressions also established document-property keys and per-element default namespaces.

The focused pair of importer test files passed 41 tests on 2026-09-20. Focused ESLint and the ssconvert test TypeScript project both passed. Separate unit tests use no native execution and no disk I/O; root SDK tests use memfs. Native captures establish selected behavior, not complete parity.

## Remaining mismatches and unmeasured areas

- Native GLib diagnostics contain runtime process identifiers/timestamps and, for invalid dates, critical messages. Importer warning bodies are deterministic and do not reproduce those runtime prefixes.
- Root repaired semantic/unknown-element diagnostic ordering with recognized event positions. Independent review found and repaired Data Type start-event ordering before nested unknown children. Cell attribute order and warning coordinates now follow XML attribute order. Style/Row/Column attribute warnings remain grouped by implementation rather than arbitrary XML attribute order. Atypical interleaved Table Rows/Columns are processed as columns then rows.
- Integer exponent/hex spellings now warn/ignore as native; native `strtol` C-long/C-int overflow behavior remains unmeasured. Floating hexadecimal attributes now warn/ignore. Captured Width INF is retained as infinity by native; package finite-axis invariants prevent representing it and the importer drops it without warning. Width NaN is absent in both implementations. Ordinary invalid colors and font/alignment/interior enums warn and retain inherited values; signed/0x sscanf color spellings and invalid border position/line enums remain unmeasured/unmatched. Boolean fallback date/text inference needs measurement.
- Blank Boolean content now becomes blank and warns as captured native; multiple Data events overwrite values/caches and preserve the cell-local type.
- Resource-limit diagnostics for out-of-bounds axes/merges/metadata deliberately establish package budgets; native crash/critical/clipping behavior for those malformed coordinates was not measured.
- Duplicate worksheet metadata records, multiple panes with late ActiveRow/ActiveCol, exact named-range replacement semantics, date years outside ordinary Gregorian use, and number-format behavior under other locale profiles remain unmeasured. Intersecting explicit-style merges now fail with the captured error body. Native magic format strings under the captured profile now match fresh differential captures. Fresh differential captures confirm imported Default is not globally applied to unstyled cells.
- Primary-source test corpus bulk import/differential coverage and alternate dependency/plugin/locale profiles are not verified by this independent review.
- The XML parser cooperatively yields; semantic processing mostly checks cancellation synchronously. Cancellation responsiveness during large post-parse semantic work is not measured.

- Efficient retained Styles records preserve empty row/column spans and explicit merged style rectangles in Gnumeric export without allocating region cells. Metadata serializes full neutral defaults for explicit empty styles. Root additionally repaired nonstandard Error quoting and replay decoding in the shared Gnumeric codec. Root repaired Gnumeric export to omit style-only axis entries and use default 48/12.75-point sizes for hidden axes without explicit sizes; this previously measured Unit=0 mismatch is resolved. Filled cells inside a merge styled earlier, cross-region overwrites, and XLSX region export beyond existing axis/cell style support need further measurement.
- Metadata ranges require complete formula parsing, while native rangeref_parse accepts a valid prefix followed by junk. Active cursor integer lexical behavior does not yet fully match native strtol.

Root's overall QA report and maintained verification results supersede these point-in-time counts when further repairs/tests land.

Second independent review added failing regressions and repairs for Type-start diagnostic ordering, integer lexical spellings, nonpositive Column Index preservation, and intersecting merge failure. Root supplied failing regressions for native named formats, repeated Data and blank Boolean content. Intersecting merges now fail with the measured deterministic error body and no output publication.

The second review additionally repaired unknown-sheet cell formulas, inherited borders, malformed-document deterministic bodies, category/keyword metadata keys and invalid timestamp omission, Row Span style inheritance, duplicate axes with preserved hidden flags, Cell warning coordinates, invalid colors/enums, repeated Data work admission, and neutral/empty-region export metadata. Root performs final cross-workspace checks after stable ownership handoff.

Final read-only review reran the original twenty-four independent cases successfully after root formula canonicalization/export repairs. An additional concrete failing regression exposed nativeFormula stripping required quotes from cell-like sheet names such as A1. Root repaired this with a per-sheet grammar quotation hook and source-derived native sheet quotation (maximum row 16777216, including leading-zero row behavior). Final independent read-only review reran all twenty-five cases successfully. No additional concrete product regression was identified in that final review.
