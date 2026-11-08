# ssconvert JavaScript architecture

Status: proposed specification, 2026-09-19. This document specifies a TypeScript
ESM implementation named exactly `ssconvert`; it does not claim implementation,
codec fidelity, numerical accuracy or rendering parity. All design decisions
below are requirements, rather than facts about existing product behavior.
The [SDK contract](../specs/ssconvert.md#proposed-public-sdk-contract) complements
this document; existing reference evidence is preserved.

## Evidence and identity

The target is released Gnumeric 1.12.61 from
<https://download.gnome.org/sources/gnumeric/1.12/gnumeric-1.12.61.tar.xz>, SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
This task downloaded and extracted it only in `out/ssconvert-design-source`,
verified that digest and independently matched all 47 plugin manifest hashes
in [coverage.json](coverage.json). GOffice 0.10.61 was separately acquired from
<https://download.gnome.org/sources/goffice/0.10/goffice-0.10.61.tar.xz> and verified
against `558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`.
Source citations below are archive-relative paths and line numbers, prefixed
`Gnumeric` or `GOffice`; they remain reproducible after owned scratch removal.
No upstream implementation body or spreadsheet fixture is incorporated here.

[reference-profile.json](reference-profile.json) is the captured dependency,
plugin, locale and oracle profile. Its `build`, `runtime`, `activatedPluginIds`,
`requalification`, `additionalReferenceProfiles` and qualification gates retain
versions, hashes, environment, exact output bytes and unavailable dependencies.
The primary measured profile uses C/UTC, GOffice 0.10.61, GLib 2.84.4,
GTK/GDK 3.24.49, libgsf 1.14.53, Pango 1.56.3 and Cairo 1.18.4.
`coverage.json#/auditOracle` is a separate binary profile, not interchangeable
with the primary captures. This task made no new native execution observations;
existing observations are cited as retained evidence, not rerun results.
Psiconv compilation, some importer fixtures, format record semantics, function
accuracy and rendering remain unqualified in those records.

## Package boundary and name review

The domain belongs in proposed `packages/ssconvert`, with TypeScript ESM,
NodeNext and `.js` import specifiers. The proposed public workspace name is
`@poe-code/ssconvert`. On 2026-09-19, inspection of repository package manifests,
root package/lockfile and command registration files found no existing ssconvert
workspace or command declaration. An unauthenticated public npm registry GET to
`https://registry.npmjs.org/@poe-code%2fssconvert` returned HTTP 404 with
`{"error":"Not found"}`. This is a time-bound collision review, not a reservation,
permission to publish, proof of scope ownership or proof of private availability.
Recheck before package creation/publication. Neither package nor public export
exists yet; do not recommend installation of the proposed name.

The exact virtual integration location is proposed
`packages/safe-bash/src/commands/ssconvert`. The user explicitly selected it,
overriding the scoped instruction's general separate-command-workspace rule for
this task. It owns capability adaptation and registration only. Parsing, workbook
operations, codecs, calculation, formatting and rendering belong in ssconvert.
Root CLI/core only wire exports and packages. Prefer no new third-party runtime
dependency in safe-bash; any justified codec/numerical/render dependency is
isolated in the domain package and audited with its transitive/bundled contents.
An internal domain import may still require packed bundling: a private workspace
being available locally does not establish published consumer availability.

Native ssconvert is an explicitly separate QA oracle. No product subprocess,
Python, native Gnumeric/LibreOffice, compiled Gnumeric WASM, native plugin loader
or conditional native fallback is permitted, including for unsupported formats.

## Inspected reusable infrastructure

`packages/office-package/src/index.ts` exports `createZipCodec`, `crc32`,
ZIP types, `createCompressionCodec` and `CodecRuntime`/`ByteSource`.
`src/zip.ts:8–55` defines `ZipLimits`, `ZipProfile` and `ZipEntry`.
`readZipArchive(bytes, limits, signal)` (`:351`) takes a complete Uint8Array and
copies it: it is bounded whole-archive admission, not streaming random access.
`decodeZipEntry` (`:655`) yields decompressed bytes; `makeZipEntry` and
`writeZipArchive` produce entries/archive bytes. Profile switches include ZIP64
reading, duplicate-name rejection, UTC timestamps and payload validation;
ZIP64 writing is rejected (`:161`, `:316`). SSConvert must charge input, archive
copy, retained compressed members, decompressed XML, DOM and output separately.
Do not infer constant-memory processing from a streaming decompression API.

`src/compression.ts` supplies gzip/gunzip and raw deflate/inflate, with injected
runtime, signal, bounded chunks and gzip member admission. Its reader's pending
fragments can be views: the caller must own retained input before producer
advancement. `package.json` declares runtime `pako: 3.0.1`; reuse does not mean
zero transitive dependencies. These are container primitives, not an OPC
relationship resolver, CFB reader, cell model or formula calculator.

`packages/safe-fs/src/xml.ts` exports namespace-aware `XmlElement`, `XmlLimits`,
`parseXmlSteps` and `parseXml`; limits include depth, nodes, attributes,
namespaces and text length. DTD/entity declarations are forbidden (`:328`).
Prefer the public `@poe-code/safe-fs/xml` parser, advancing steps cooperatively
and charging work, after bounded UTF decoding and encoding admission. This
parser consumes a complete string/tree; XML streaming and large-part memory
behavior need independent verification. A native format accepting constructs
this parser rejects would be an explicit compatibility blocker, not an excuse
to enable external entities. `packages/docx/src/package-xml.ts` demonstrates
bounded decoding, snapshot and DOM charging, but is document-specific and
must not become a spreadsheet dependency or be imported through private paths.
No parser/library change is authorized by this specification.

Pandoc's [XLSX gate](../plans/pandoc-xlsx-sdk-gate.md) remains blocked pending a
delivered public workbook SDK and independent adapter qualification. This task
provides its required contract, not an implemented SDK or permission to enable
XLSX, introduce a replacement reader, or modify the gate tests.

## Domain decomposition and sparse model

One invocation creates one engine session owning workbook storage, interning,
calculation graph, budgets and cleanup. There are no process-global workbook,
function-cache, locale or renderer singletons. Immutable descriptors may be
shared; mutable imported workbooks, byte buffers and resources may not.

| Model           | Required distinctions and responsibilities                                                                                                                                                                                       | Primary source basis                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Workbook        | Ordered stable sheet IDs, active sheet/view, date system, calculation/iteration settings, metadata, workbook/local names, external links and declared source profile                                                             | Gnumeric `src/workbook.h`; `src/workbook-priv.h`; `src/xml-sax-read.c`                                                   |
| Sheet           | Sparse coordinate map, logical dimensions separate from occupied/content/styled extents, visibility, merges, range styles, row/column runs, panes, selections, filters, validation, conditional styles, protection               | Gnumeric `src/sheet.h:35`; `src/cell.h`; `src/sheet-style.h`                                                             |
| Cell/value      | Absent cell, explicit blank, empty string, rich string, boolean, binary64 number and error identity; formula/cache presence independently; source numeric lexical bytes where needed                                             | Gnumeric `src/cell.h`; `src/value.h`; `src/value.c`; `plugins/excel/xlsx-read.c`                                         |
| Expression      | Immutable discriminated AST: literals, unary/binary operators, functions, names, cell/range references, intersections/unions, arrays, shared formula groups and array corner/member relations; relative references retain origin | Gnumeric `src/expr.h:11`; `src/parser.y`; `src/position.h`; `src/expr-name.h`                                            |
| Format          | Interned style records and range application; number-format source/dialect plus parsed sections, conditions, locale/date/elapsed tokens; rich text runs, font, color, fill, borders, alignment                                   | Gnumeric `src/mstyle.h`; `src/style.h`; `src/rendered-value.h`; GOffice `goffice/utils/go-format.c`                      |
| Object          | Stable identity, native type, anchor mode/coordinates/offsets, order, styles, image bytes, charts with series expressions/axes/plot types/labels, comments and hyperlinks; opaque bounded unsupported data with provenance       | Gnumeric `src/sheet-object.h`; `src/sheet-object-graph.h`; `src/sheet-object-image.h`; `src/sheet-object-cell-comment.h` |
| Print           | Paper ID/dimensions, margins/orientation, areas/titles, manual/automatic breaks, page order, percentage/fit scaling, headers/footers, gridlines/headings, hidden items and selected objects                                      | Gnumeric `src/print-info.h:58`; `src/print.c`; `src/print-info.c`                                                        |
| Solver/analysis | Target/input refs, objective/model/algorithm IDs, constraints and integer/binary domains, bounds/options, convergence/status/results; analysis descriptors, typed properties and generated report cells/formulas/styles          | Gnumeric `src/tools/gnm-solver.h:60–139`; `src/tools/analysis-tools.h`; `src/ssconvert.c:821–1043`                       |

Coordinates are zero-based safe integers validated against each sheet/codec's
limits. Never allocate a rows-by-columns matrix from declared dimension or a
single far-away cell. Enumerations and range projection have explicit visit
budgets. Stable IDs survive rename/reorder; source names/expressions preserve
spelling separately. Missing data and unknown semantics cannot be silently
coerced into blank, zero, default styles or successful unsupported objects.
An opaque record is preservation evidence only where a writer actually retains
it safely; it is not understood calculation/rendering support.

Calculation separates parsing, dependency discovery, dirty propagation,
evaluation, numerical functions and cache publication. Use reference/range
indexes rather than expanding whole-column dependencies into cells. Function
descriptors encode arity, coercion, reference/array handling, lazy arguments,
volatility, environment capabilities, errors and provenance. Audit built-ins
and the complete function reconciliation in coverage.json, not an advertised
function count. No dynamic eval, macro execution or automatic external-link
resolution. Formula caches remain source values with presence/trust/dirty state;
reading/formatting cannot silently recalculate. Native conversion is different:
Gnumeric `src/ssconvert.c:1468–1470` optionally marks all cells dirty with
`--recalc` and always runs `gnm_app_recalc`. The CLI uses that native calculation
policy; the independent read-only workbook SDK defaults to no evaluation.

## Declarative codec registry

Providers live in one file each under proposed `src/providers`, exporting a
single descriptor (possibly several directional services in one format family).
A build-time filesystem scan generates a static ESM manifest; runtime uses no
ambient directory scan or native plugins. Registration, dispatch, extension/MIME
indexes, options validation and listings derive from these descriptors. Adding
one provider file requires no hand-maintained index or provider-ID if/case
chain. Generic branches on service direction, save scope or capability are
allowed. Duplicate `(direction, exactId)` fails registration; the same ID may
legitimately have separate opener/saver descriptors. Generated inventory must
still be tested against independently retained oracle lists, not itself.

A service descriptor carries exact Gnumeric ID and C-locale description bytes,
source/build condition, probe levels and callback, declared/effective import
priority, default saver registration/priority, registration order, extensions,
MIME types, format level, overwrite/interactivity, save scope, sheet-selection,
option grammar and required capabilities. Declaration, reference activation,
JavaScript implementation and qualification are separate states. Unimplemented
services must not masquerade as available product services. A partial registry
is explicitly partial and does not satisfy the released-profile target.

GOffice `goffice/app/go-plugin-service.c:453–468` clamps declared opener priority
to 0..100 (thus Excel encoding opener's declared 200 becomes 100), defaults it to
50 and probe to TRUE. Saver defaults at `:812–845` are workbook scope,
write-only level, default priority -1 (not registered as default), overwrite TRUE,
interactive FALSE and sheet-selection FALSE. Core registrations override these.
Preserve declared and effective values: absence is not the same as a zero.

GOffice `goffice/app/file.c:1257–1286` chooses extension writers first from the
priority-ordered defaults, otherwise from registered savers with preference for
smaller scope enum and registration-order ties. Global default selection is
separate. Import probing must follow the engine's probe levels, priority and
registration order, with replayable buffered prefixes/explicit random access;
no irrevocable consumption of another provider's input. Remaining probe-level,
registration tie and case-folding behavior requires original oracle cases.
Listings sort by exact ID and omit interactive-only services, writing stderr
(Gnumeric `src/ssconvert.c:392–461`). Locale translations come from a qualified
profile, never host Intl defaults.

The following directional manifest register is freshly checked against the
47 authenticated manifests. Descriptions/extensions/MIME are in
`coverage.json#/services` and are descriptor input, not paraphrased labels.
`—` means no declared value; opener priorities show declared/effective values.
Saver scope `workbook*` and selection `false*` are GOffice defaults above.
Core services and grammar follow the table. Listing presence still depends on
the captured activation profile.

| Exact ID / direction                        | Exact C description                                                | Probe / declared-effective priority | Default saver priority | Extension / MIME                                                                                                                                                                                                                                     | Scope / sheet-selection | Source                                    |
| ------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------- |
| `Gnumeric_applix:applix` / read             | Applix (\*.as)                                                     | TRUE / 100                          | —                      | as / application/x-applix-spreadsheet                                                                                                                                                                                                                | —                       | `plugins/applix/plugin.xml.in:11`         |
| `Gnumeric_dif:dif` / read                   | Data Interchange Format (\*.dif)                                   | FALSE / 1                           | —                      | dif / —                                                                                                                                                                                                                                              | —                       | `plugins/dif/plugin.xml.in:11`            |
| `Gnumeric_dif:dif` / write                  | Data Interchange Format (\*.dif)                                   | —                                   | —                      | dif / —                                                                                                                                                                                                                                              | sheet / false\*         | `plugins/dif/plugin.xml.in:19`            |
| `Gnumeric_Excel:excel` / read               | MS Excel™ (\*.xls)                                                 | TRUE / 100                          | —                      | xls, xlw, xlt / application/vnd.ms-excel, application/excel, application/msexcel, application/x-excel, application/x-ms-excel, application/x-msexcel, application/x-xls, application/xls, application/x-dos_ms_excel, zz-application/zz-winassoc-xls | —                       | `plugins/excel/plugin.xml.in:12`          |
| `Gnumeric_Excel:excel_biff8` / write        | MS Excel™ 97/2000/XP                                               | —                                   | 1                      | xls / application/vnd.ms-excel                                                                                                                                                                                                                       | workbook* / false*      | `plugins/excel/plugin.xml.in:35`          |
| `Gnumeric_Excel:excel_biff7` / write        | MS Excel™ 5.0/95                                                   | —                                   | —                      | xls / application/vnd.ms-excel                                                                                                                                                                                                                       | workbook* / false*      | `plugins/excel/plugin.xml.in:46`          |
| `Gnumeric_Excel:excel_dsf` / write          | MS Excel™ 97/2000/XP & 5.0/95                                      | —                                   | —                      | xls / application/vnd.ms-excel                                                                                                                                                                                                                       | workbook* / false*      | `plugins/excel/plugin.xml.in:53`          |
| `Gnumeric_Excel:excel_xml` / read           | MS Excel™ 2003 SpreadsheetML                                       | TRUE / 1                            | —                      | xml / —                                                                                                                                                                                                                                              | —                       | `plugins/excel/plugin.xml.in:62`          |
| `Gnumeric_Excel:xlsx` / read                | ECMA 376 / Office Open XML [MS Excel™ 2007/2010] (\*.xlsx)         | TRUE / 100                          | —                      | xlsx, xltx, xlsb, xlsm, xltm / application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.openxmlformats-officedocument.spreadsheetml.template                                                                               | —                       | `plugins/excel/plugin.xml.in:72`          |
| `Gnumeric_Excel:xlsx` / write               | ECMA 376 1st edition (2006); [MS Excel™ 2007]                      | —                                   | —                      | xlsx / application/vnd.openxmlformats-officedocument.spreadsheetml.sheet                                                                                                                                                                             | workbook* / false*      | `plugins/excel/plugin.xml.in:94`          |
| `Gnumeric_Excel:xlsx2` / write              | ISO/IEC 29500:2008 & ECMA 376 2nd edition (2008); [MS Excel™ 2010] | —                                   | —                      | xlsx / application/vnd.openxmlformats-officedocument.spreadsheetml.sheet                                                                                                                                                                             | workbook* / false*      | `plugins/excel/plugin.xml.in:102`         |
| `Gnumeric_Excel:excel_enc` / read           | MS Excel™ (\*.xls) requiring encoding specification                | FALSE / 200/100                     | —                      | — / —                                                                                                                                                                                                                                                | —                       | `plugins/excel/plugin.xml.in:109`         |
| `Gnumeric_glpk:glpk` / write                | GLPK Linear Program Solver                                         | —                                   | —                      | cplex / application/glpk                                                                                                                                                                                                                             | sheet / false\*         | `plugins/glpk/plugin.xml.in:11`           |
| `Gnumeric_GnomeGlossary:po` / write         | Gnome Glossary PO file format                                      | —                                   | —                      | po / —                                                                                                                                                                                                                                               | workbook* / false*      | `plugins/gnome-glossary/plugin.xml.in:12` |
| `Gnumeric_html:html` / read                 | HTML (_.html, _.htm)                                               | TRUE / 100                          | —                      | html, htm / —                                                                                                                                                                                                                                        | —                       | `plugins/html/plugin.xml.in:11`           |
| `Gnumeric_html:html32` / write              | HTML 3.2 (\*.html)                                                 | —                                   | —                      | html / —                                                                                                                                                                                                                                             | workbook\* / true       | `plugins/html/plugin.xml.in:20`           |
| `Gnumeric_html:html40` / write              | HTML 4.0 (\*.html)                                                 | —                                   | —                      | html / —                                                                                                                                                                                                                                             | workbook\* / true       | `plugins/html/plugin.xml.in:26`           |
| `Gnumeric_html:html40frag` / write          | HTML (\*.html) fragment                                            | —                                   | —                      | html / —                                                                                                                                                                                                                                             | workbook\* / true       | `plugins/html/plugin.xml.in:32`           |
| `Gnumeric_html:xhtml` / write               | XHTML (\*.html)                                                    | —                                   | —                      | html / —                                                                                                                                                                                                                                             | workbook\* / true       | `plugins/html/plugin.xml.in:38`           |
| `Gnumeric_html:xhtml_range` / write         | XHTML range - for export to clipboard                              | —                                   | —                      | html / —                                                                                                                                                                                                                                             | range / false\*         | `plugins/html/plugin.xml.in:44`           |
| `Gnumeric_html:latex` / write               | LaTeX 2e (\*.tex)                                                  | —                                   | —                      | tex / —                                                                                                                                                                                                                                              | sheet / true            | `plugins/html/plugin.xml.in:51`           |
| `Gnumeric_html:latex_table` / write         | LaTeX 2e (\*.tex) table fragment                                   | —                                   | —                      | tex / —                                                                                                                                                                                                                                              | sheet / true            | `plugins/html/plugin.xml.in:57`           |
| `Gnumeric_html:latex_table_visible` / write | LaTeX 2e (\*.tex) table fragment of visible rows                   | —                                   | —                      | tex / —                                                                                                                                                                                                                                              | sheet / true            | `plugins/html/plugin.xml.in:63`           |
| `Gnumeric_html:roff` / write                | TROFF (\*.me)                                                      | —                                   | —                      | me / —                                                                                                                                                                                                                                               | workbook* / false*      | `plugins/html/plugin.xml.in:69`           |
| `Gnumeric_lotus:lotus` / read               | Lotus 123 (_.wk1, _.wks, \*.123)                                   | TRUE / 50                           | —                      | wk1, wk4, wr1, wks, 123 / application/vnd.lotus-1-2-3, application/x-123                                                                                                                                                                             | —                       | `plugins/lotus-123/plugin.xml.in:11`      |
| `Gnumeric_lpsolve:lpsolve` / write          | LPSolve Linear Program Solver                                      | —                                   | —                      | lp / application/lpsolve                                                                                                                                                                                                                             | sheet / false\*         | `plugins/lpsolve/plugin.xml.in:11`        |
| `Gnumeric_mps:mps` / read                   | Linear and integer program (\*.mps) file format                    | FALSE / 1                           | —                      | mps / application/x-mps                                                                                                                                                                                                                              | —                       | `plugins/mps/plugin.xml.in:11`            |
| `Gnumeric_oleo:oleo` / read                 | GNU Oleo (\*.oleo)                                                 | FALSE / 100                         | —                      | oleo / application/x-oleo                                                                                                                                                                                                                            | —                       | `plugins/oleo/plugin.xml.in:11`           |
| `Gnumeric_OpenCalc:openoffice` / read       | Open Document Format (_.sxc, _.ods)                                | TRUE / 1                            | —                      | ods, ots, sxc, stc / application/vnd.oasis.opendocument.spreadsheet, application/vnd.oasis.opendocument.spreadsheet-template, application/vnd.sun.xml.calc, application/vnd.sun.xml.calc.template                                                    | —                       | `plugins/openoffice/plugin.xml.in:11`     |
| `Gnumeric_OpenCalc:openoffice` / write      | ODF 1.2 strict conformance (\*.ods)                                | —                                   | —                      | ods / application/vnd.oasis.opendocument.spreadsheet                                                                                                                                                                                                 | workbook* / false*      | `plugins/openoffice/plugin.xml.in:28`     |
| `Gnumeric_OpenCalc:odf` / write             | ODF 1.2 extended conformance (\*.ods)                              | —                                   | —                      | ods / application/vnd.oasis.opendocument.spreadsheet                                                                                                                                                                                                 | workbook* / false*      | `plugins/openoffice/plugin.xml.in:35`     |
| `Gnumeric_paradox:paradox` / read           | Paradox database or primary index file (_.db, _.px)                | FALSE / 100                         | —                      | db, px / —                                                                                                                                                                                                                                           | —                       | `plugins/paradox/plugin.xml.in:11`        |
| `Gnumeric_paradox:paradox` / write          | Paradox database (\*.db)                                           | —                                   | —                      | db / —                                                                                                                                                                                                                                               | workbook* / false*      | `plugins/paradox/plugin.xml.in:20`        |
| `Gnumeric_plan_perfect:pln` / read          | Plan Perfect Format (PLN) import                                   | TRUE / 1                            | —                      | pln / application/x-planperfect                                                                                                                                                                                                                      | —                       | `plugins/plan-perfect/plugin.xml.in:11`   |
| `Gnumeric_psiconv:psiconv` / read           | Psion (\*.psisheet)                                                | TRUE / 100                          | —                      | psisheet / —                                                                                                                                                                                                                                         | —                       | `plugins/psiconv/plugin.xml.in:11`        |
| `Gnumeric_QPro:qpro` / read                 | Quattro Pro (_.wb1, _.wb2, \*.wb3)                                 | TRUE / 100                          | —                      | wb1, wb2, wb3 / application/x-quattropro, application/x-quattro-pro                                                                                                                                                                                  | —                       | `plugins/qpro/plugin.xml.in:11`           |
| `Gnumeric_sc:sc` / read                     | SC/xspread                                                         | TRUE / 51                           | —                      | — / application/x-sc                                                                                                                                                                                                                                 | —                       | `plugins/sc/plugin.xml.in:11`             |
| `Gnumeric_sylk:sylk` / read                 | MultiPlan (SYLK)                                                   | TRUE / 1                            | —                      | slk, sylk / application/x-sylk                                                                                                                                                                                                                       | —                       | `plugins/sylk/plugin.xml.in:11`           |
| `Gnumeric_sylk:sylk` / write                | MultiPlan (SYLK)                                                   | —                                   | —                      | slk / application/x-sylk                                                                                                                                                                                                                             | sheet / false\*         | `plugins/sylk/plugin.xml.in:23`           |
| `Gnumeric_xbase:xbase` / read               | Xbase (\*.dbf) file format                                         | FALSE / 100                         | —                      | dbf / application/dbase, application/dbf, application/x-dbase, application/x-dbf, application/x-xbase, zz-application/zz-winassoc-dbf                                                                                                                | —                       | `plugins/xbase/plugin.xml.in:11`          |

Core services are `Gnumeric_XmlIO:sax` (read/write, gnumeric; read also xml;
read priority 50/probe; write default priority 50, workbook),
`Gnumeric_XmlIO:sax:0` (write xml, workbook), `Gnumeric_stf:stf_csvtab`
(read csv/tsv/txt, priority 0/probe), `Gnumeric_stf:stf_assistant` (interactive
text opener, priority 0/no probe; noninteractive txt workbook writer with
sheet-selection), `Gnumeric_stf:stf_csv` (csv sheet writer with sheet-selection)
and `Gnumeric_pdf:pdf_assistant` (pdf workbook writer with sheet-selection).
Exact descriptions and MIME data must be taken from Gnumeric
`src/xml-sax-read.c:3924–3942`, `src/xml-sax-write.c:1740–1768`,
`src/stf.c:580–637`, `src/stf-export.c:775–788` and
`src/print-info.c:1070–1087`. Null MIME stays null, not guessed from an extension.

The core C-locale descriptor data supplement the manifest table (null means
no explicit MIME on these saver registrations, following GOffice
`goffice/app/file.c:465–477`):

| Exact ID / direction                 | Exact description                       | Extension     | MIME                                                                                                                             |
| ------------------------------------ | --------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `Gnumeric_XmlIO:sax` / read          | Gnumeric XML (\*.gnumeric)              | gnumeric, xml | application/x-gnumeric                                                                                                           |
| `Gnumeric_XmlIO:sax` / write         | Gnumeric XML (\*.gnumeric)              | gnumeric      | application/x-gnumeric                                                                                                           |
| `Gnumeric_XmlIO:sax:0` / write       | Gnumeric XML uncompressed (\*.xml)      | xml           | application/xml                                                                                                                  |
| `Gnumeric_stf:stf_csvtab` / read     | Comma or tab separated values (CSV/TSV) | csv, tsv, txt | application/tab-separated-values, text/comma-separated-values, text/csv, text/x-csv, text/spreadsheet, text/tab-separated-values |
| `Gnumeric_stf:stf_assistant` / read  | Text import (configurable)              | none          | text/plain, text/csv, text/x-csv, text/comma-separated-values, text/tab-separated-values                                         |
| `Gnumeric_stf:stf_assistant` / write | Text (configurable)                     | txt           | null                                                                                                                             |
| `Gnumeric_stf:stf_csv` / write       | Comma separated values (CSV)            | csv           | null                                                                                                                             |
| `Gnumeric_pdf:pdf_assistant` / write | PDF export                              | pdf           | null                                                                                                                             |

Option grammar uses a scanner/parser, never regex replacement. GOffice
`goffice/utils/go-glib-extras.c:1227–1310` parses ordered `name=value` pairs:
Unicode whitespace surrounds keys/equals, quoted keys/values use
`go_strunescape`, unquoted keys accept Unicode alphanumerics and
`-!_.,:;|/$%#@~`, and unquoted values run to whitespace (including empty value).
This is not comma-separated key/value syntax. `go_strunescape` (`:289–315`) removes a backslash before the next byte;
it does not interpret C/JSON escape sequences such as backslash-n as newline.
Boundary/Unicode/error bytes still need oracle qualification. Retain duplicate pairs and order until provider semantics
consume them. The CLI's repeated `-O` is scalar-last, not pair concatenation.

| Grammar descriptor | Keys and semantic delegation                                                                                                                                                                                                                | Primary source                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Common export      | `sheet` appends named sheet; `active-sheet` appends current sheet; unknown keys error; selection capability checked independently                                                                                                           | Gnumeric `src/gutils.c:1080–1120`; `src/ssconvert.c:330–380`        |
| Configurable text  | `eol` accepts unix/mac/windows case-insensitively; `charset`, `locale`, `quote`, `separator`, `format`, `transliterate-mode`, `quoting-mode`, `quoting-on-whitespace` use typed GObject property grammar; delegate remaining keys to common | Gnumeric `src/stf-export.c:714–749`                                 |
| PDF                | `object`, `paper`, then common delegation; paper names/dimensions use captured profile                                                                                                                                                      | Gnumeric `src/print-info.c:1002–1057`                               |
| Graph images       | `resolution` uses atof conversion, valid 1..10000, default 100; other keys error                                                                                                                                                            | Gnumeric `src/ssconvert.c:1085–1129`                                |
| Analysis           | First-colon key/value split, property conversions and repeated-key replacement; special fields and ignored/unknown behavior stay distinct from export options                                                                               | Gnumeric `src/ssconvert.c:821–1043`; coverage.json analysisProtocol |

GObject enum nicks, property defaults, quote escaping, encodings/transliteration,
PDF object selection and malformed numeric strings require their own descriptor
contracts and independent cases. A list of keys is not a completed grammar.
Do not assume plain CSV uses the configurable text writer's callback.

## JavaScript candidate assessment

This is a primary-document capability review, not execution or benchmarking.
Pinned author documentation and LICENSE files were acquired only in the owned
out directory; provenance/hashes below allow reproduction. No candidate is
adopted. `documented` means the author advertises that capability; `unproven`
means no Gnumeric-parity or bounded-execution evidence, not proven absence.

| Complete target family                                             | SheetJS CE 0.18.5                                                                       | ExcelJS 4.4.0                                                                                      | HyperFormula 3.0.0                                                                             | Domain decision                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| CSV/TSV and configurable text/encoding                             | CSV/text documented; native option/locale grammar unproven                              | CSV documented; native grammar unproven                                                            | Not a codec contract                                                                           | Native-profile text descriptors, bounded scanner and encoding capability                          |
| Native gzip/plain Gnumeric XML                                     | No claimed parity in reviewed format table                                              | No claimed parity                                                                                  | Not a codec contract                                                                           | Domain codec plus office compression and parsed XML                                               |
| XLSX editions/SpreadsheetML, XLS BIFF7/8/dual                      | Broad Excel read/write documented, not native edition/cache/record parity               | XLSX documented; not legacy BIFF contract                                                          | Not a file codec                                                                               | Shared OPC/CFB/binary infrastructure; qualify every native direction/edition                      |
| ODF/Sun XML                                                        | ODS documented; native strict/extended/Sun fidelity unproven                            | No claimed codec contract                                                                          | Not a codec contract                                                                           | Domain descriptors and XML/ZIP, original record cases                                             |
| DIF/SYLK/Lotus/Quattro/DBF                                         | Broad read/write subsets documented; never infer identical version support              | No claimed legacy codec contract                                                                   | Not a codec contract                                                                           | Dedicated validated legacy providers; no extension substitution                                   |
| Applix/Oleo/SC/PlanPerfect/Psion/Paradox/MPS                       | Complete native scope not established by reviewed format table                          | No claimed contract                                                                                | No claimed contract                                                                            | Each retained source service remains required/unqualified; optional oracle blockers retained      |
| HTML/XHTML/range/roff/TeX/gettext/LP                               | HTML advertised; complete native document/solver writer scope unproven                  | No complete native contract                                                                        | No file writer contract                                                                        | Domain semantic document/solver codecs                                                            |
| Full formulas/arrays/names/cache/analysis/goal seek/solver         | Formula fields documented; complete evaluator/parity unproven                           | Explicitly cannot calculate formula results                                                        | Parser/evaluator, ~400 functions advertised; Gnumeric function/analysis/solver parity unproven | Owned expression/calculation engine and descriptors; numerical equivalence independently tested   |
| Objects/charts/images/fonts/print/PDF and all native graph targets | No complete GOffice renderer contract; CE/Pro feature distinctions                      | Images/print settings documented, not GOffice renderer parity                                      | Headless evaluator, not a rendering contract                                                   | Separate scene/layout/JavaScript rendering capabilities, each target qualified                    |
| Sparse/cache-preserving bounded I/O                                | Formula/value fields useful; parse memory, truncation/loss and cancellation unqualified | Formula/result/shared/array representations useful; streaming XLSX does not prove all-input bounds | Dependency evaluator, not raw file/cache preservation                                          | Admission before allocation, missing-cache state, bounded iteration and cooperative work required |

SheetJS README explicitly says unsupported features are not written and
range-limited formats silently truncate (`README.md:4030–4040`); that behavior
cannot silently define our loss/diagnostic contract. ExcelJS states results must
be supplied (`README.md:2631`) and shows formula/result and shared formula values.
No candidate's supplied-result shape alone proves preservation of missing,
empty, error, stale or array caches through native conversion. Streaming APIs
alone do not prove decompression, string-table, expression or rendering budgets.

| Primary artifact URL (tag-relative)                                           | SHA-256                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `https://raw.githubusercontent.com/SheetJS/sheetjs/v0.18.5/README.md`         | `cc16ec45f95cabd32b22956901859ce4b7ee469df34fab97e05138b483de0f1f` |
| Same tag `LICENSE` (Apache-2.0)                                               | `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64` |
| `https://raw.githubusercontent.com/exceljs/exceljs/v4.4.0/README.md`          | `b14a6a818034a1445a3d69a8584fa5f6f88f3a987dc2111e8acb776d901e12bd` |
| Same tag `LICENSE` (MIT)                                                      | `2ed526b7e7c7681dc2347995b5036ddf73dc27d0539cdea59b6d4a72b63a57a0` |
| `https://raw.githubusercontent.com/handsontable/hyperformula/3.0.0/README.md` | `a04e6e39c08db9ab3f57ce49b8ce10e9a1667cdec02db74147bd7c9388f115d5` |
| Same tag `LICENSE.txt` (GPLv3/proprietary dual terms)                         | `10c0e316b5919bfa554d3574eacb80c377395dd21ea700c504cad12822115076` |

SheetJS v0.20.3 GitHub README lookup failed with HTTP 404; no conclusion about
that release's capabilities is inferred. The reviewed CE release is 0.18.5,
not a current-version recommendation. Legal notice review does not authorize
adoption or GPL implementation translation. Exact package artifacts, bundled
codepages/assets, transitive licenses, advisories, numerical fidelity and work
admission need review before any dependency decision. Initial choice: existing
ZIP/compression/XML infrastructure plus original TypeScript domain components;
optional small JavaScript primitives only with per-capability justification.

## Safe-bash host integration and invariants

Proposed public integration is explicit opt-in `ssconvertCommands(options)`;
no default `agentCommands` inventory change in this task. It registers the literal
name `ssconvert`, preflights collisions and follows existing replacement policy.
SDK descriptor availability and the host's capability bindings determine usable
services; a trusted host cannot silently replace a reference service with a
semantically different codec. Registration/inventory/public packed exports require
separate implementation tests before availability is advertised.

Inspected contracts are `packages/safe-bash-contracts/src/command.ts`, `io.ts`,
`filesystem.ts`, plus `packages/safe-bash/src/contracts/command.md` and existing
`src/commands/pandoc/index.ts`. Adapt `getCommandArguments` with immutable raw
byte provenance, fs/cwd, stdin origin, stdout/stderr sinks, signal, input/output
budgets, cooperative work and cleanup hooks. Pandoc's adapter is an example of
capability adaptation, not proof of ssconvert behavior or a reusable status map.
Never round-trip argv/path identity through lossy text. GLib filename/locale
encoding and invalid-byte behavior remain a measured contract gap for this SDK.

Register invocation cleanup synchronously before acquiring streams, spools,
font resources or files. Use existing output operations and destination child
scopes; await backpressure, copy retained producer views before advancing, and
enforce aggregate shell plus domain limits before allocations. Closing stdout
must not cancel independent file/stderr children. Cleanup is idempotent, blocks
new acquisition, drains admitted cooperative work and runs in finally; opaque
host work has no invented preemption guarantee. Propagate cancellation and
preserve root/control/local cancellation precedence.

URI schemes, descriptor aliases, clipboard targets, reference lib/data paths,
font bytes, locale tables, clock/random, external data and trusted extensions
are explicit SDK host bindings. No host HOME/env/fonts/credentials, global
locale mutation, module-path discovery or unrestricted network. Dynamic plugin
names are configuration, never executable code paths. Unsupported inherited
GTK flags require a qualified safe mapping or an explicit divergence/blocker;
never ignore them merely because this engine is headless.

Each execution realm owns its resources, buffers, error mapping and budget
bindings. No cross-realm mutable cache or callback transfer bypasses existing
contracts. Replay consumes the same owned inputs and explicit capability
observations (clock/random/font/data/profile identities), preserving read/write
ordering and authority decisions. This specifies ssconvert's obligations; it
claims no new replay infrastructure or guarantees beyond supplied hosts.

## Resource and compatibility contracts

Budgets and capability mappings are SDK/host configuration only, never invented
CLI flags. All limits are finite validated nonnegative safe integers, with live
aggregate usage and cancellation. Resource denials are named safety divergences
from unconstrained native behavior, not native parse errors or success.

| Budget group         | Admission/charge points                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input/output/storage | Per input, aggregate bytes, retained copies, spooled bytes/files, archive members/paths/ratio/expanded bytes, output files/bytes and sink queues      |
| Workbook/XML         | Sheets, populated cells, styles/runs/names/objects, strings/text bytes, XML parts/nodes/attributes/depth, relationships and traversal visits          |
| Calculation/analysis | Expression bytes/nodes/depth, dependencies/edges/range visits, function work/array elements, iteration count, numerical/solver work and report output |
| Rendering            | Font/image bytes, image decoded pixels, scene nodes/path segments, charts/series/points, pages, raster dimensions/pixels and layout work              |
| Invocation           | Elapsed deadline, cooperative work/yield interval, active resources; min of domain limits and remaining shell allowances, never a reset               |

Default numeric values remain to be calibrated against original corpus/work
measurements before implementation. The API requires explicit host budgets, so
there is no accidental unlimited default while values remain unsettled. Limits
must cover string/table expansion and retained-cache duplication, not just file
size; ratios supplement absolute decompression limits rather than replace them.

Four acceptance contracts stay independent: exact CLI argv/help/status/channel
bytes under the pinned profile; serialized workbook semantics including formulas,
caches/styles/objects and documented native loss; rendering equivalence under
pinned fonts/metrics/locales with justified numeric/pixel tolerances; and byte
determinism for artifacts where the native profile establishes it. ZIP/PDF
metadata differences neither establish semantic failure nor excuse layout defects.
No blanket diagnostic/container normalization. Existing Markdown procedures in
[reference QA](../plans/ssconvert-reference-qa.md) and
[audit QA](../plans/ssconvert-audit-qa.md) define manual evidence collection;
implementation will require original independent cases and TDD, memfs/mocked
capabilities, no disk/native/LLM unit work and ad hoc CLI screenshots.

This specification leaves implementation, grammar edge cases, profile-dependent
plugins, legacy edition/encryption details, numerical/solver accuracy, font
metrics, image-target availability, budgets/default calibration, packed exports
and product licensing open. They are blockers to parity, not excluded features.

## Verification of this specification

Fresh verification passed for both authenticated source archives, all 47
Gnumeric plugin manifest hashes, 40 directional plugin file-service attributes
and exact descriptions checked through parsed XML, codec-ID membership including
core services, six pinned candidate-document/license hashes, 21 cited model
source files and local document links. Repository Prettier verification passed
for this architecture and the extended SDK specification. Owned source archives,
extractions and candidate captures were then removed from out; unrelated scratch
and existing edits were preserved. No native parity run, numerical/rendering
qualification, product unit test or public consumer build is claimed for this
documentation-only task.
