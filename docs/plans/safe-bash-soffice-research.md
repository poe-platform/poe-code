# Soffice source contract and acceptance matrix

Research task `research-soffice`, 2026-09-20. Inspected local `main` at
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, preserving concurrent edits.
This is a source-derived specification and acceptance design. Native conversion,
engine implementation, layout fidelity and installed-consumer qualification remain open.

## Evidence and ownership

Authority is LibreOffice/core revision
`d17755172ac96e54e3f10f35dd1b1680f0ef84bd`, not the installed application
manifest `26.8.0.3`. Earlier native version attempts failed before main in dyld;
no native conversion output was observed. Those attempts qualify neither a version
report nor any stdout/stderr/exit-code expectation. No native execution was retried
for this documentation task. Fresh source receipts below qualify source inspection only.

Repository evidence: `git ls-tree -r --name-only HEAD packages scripts` and working-tree
searches found no soffice/ssconvert command implementation or soffice tests.
`packages/pandoc/src/formats/index.ts` registers DOCX/PPTX/RTF/XLSX and PDF;
`formats/xlsx.ts` declares `read: true`, `write: false`; no ODF format is registered.
Pandoc's manifest includes parse5/entities/saxes/jpeg-js/jsonc-parser; PDF's includes
pdf-lib/fontkit/pako. An empty command dependency map would not erase those runtime
imports. Reuse requires an audited first-party primitive closure and license review;
never copy external dependency source into a supposedly dependency-free bundle.
Spreadsheet support remains in its existing engine; no duplicate ssconvert workspace.

The requested package-pattern path has an unrelated working-tree deletion/relocation.
Read its HEAD version and [existing archive](archive/safe-bash-command-package-pattern.md)
without restoring it. Future implementation belongs in
`packages/safe-bash-command-soffice`, manifest name `safe-bash-command-soffice`,
`private: true`, TypeScript ESM, no external runtime dependencies. Safe Bash composes
and exports `@poe-platform/safe-bash/commands/soffice`; it owns no conversion logic.
Use canonical `safe-bash-contracts` ownership/brands/errors, no dependency back to
safe-bash. Bundle private implementation, declarations and admitted assets into the
public artifact. Verify installed NodeNext and runtime consumers without workspace
symlinks or private imports. Do not publish the private workspace. No package or
speculative stub is added by this research task.

## Argument/event contract

The following are native source findings, not fresh native transcripts. CLI argv
and SDK argv must enter the same parser; typed SDK settings must express equivalent
filters, options, limits and cancellation without ambient profile defaults.

| Input or interaction | Pinned meaning | Product admission / acceptance |
| --- | --- | --- |
| `--convert-to FORMAT[:FILTER[:OPTIONS]]` | Consumes next operand, stores global params, switches subsequent file event to Conversion, forces headless | Parse extension, first filter delimiter, retain remaining options including colons; validate filter/options separately |
| `--headless` | Sets headless; does not itself select conversion | Neutral event flag; no UI available |
| `--outdir PATH` | Consumes next operand only in Conversion or BatchPrint event | Conversion-only product; VFS path, no ambient cwd |
| `--outdir /dst --convert-to pdf a.docx` | Invalid event when outdir encountered | Parser rejection before outputs |
| `--convert-to pdf --nologo --outdir /dst a.docx` | Neutral flag need not reset Conversion | Accept; do not implement adjacency check from error wording |
| `a.docx --convert-to pdf b.docx` | a is open-list; b is conversion-list | Open/UI request explicitly denied; no retroactive a conversion |
| `--convert-to pdf a.docx --convert-to txt b.docx` | Global params overwritten; both conversion-list files use final params | Test final txt params for both; not per-file snapshots |
| repeated `--outdir` | Global stored outdir replaced | Test final directory, all conversion-list files |
| `--infilter=NAME:OPTIONS` | Forced import descriptor; split first colon, retain remainder | Declarative import capability validation; never execute options as code |
| `--cat` | txt:Text, conversion/headless; temporary export, ReadLine then stdout lines | Separate text profile; exact newline/encoding capture still required |
| `--script-cat` | Code/library inspection path | Separate inert inspection target; no macros run; unimplemented must reject |
| `--long`, deprecated `-long` | Both recognized; deprecated form emits warning | Preserve warning independently of conversion outcome |
| `-h`, `-?`, `-n`, `-o`, `-p` | Short forms retained natively | Help eligible; new/open/printing rejected explicitly |
| missing convert operand | Parser text `--convert-to must be followed by output_file_extension[:output_filter_name]` | Exact message source-pinned; desktop formatting/exit unresolved |
| missing outdir operand | Parser text `--outdir must be followed by output directory path` | Same evidence limit |
| outdir wrong event | Parser text `--outdir must directly follow either output filter specification of --convert-to, or --print-to-file or its printer specification` | Text does not imply strict adjacency |
| listener/accept, printing, UI, profile/bootstrap paths | Native capabilities exceed isolated product | Explicit denied semantics; no host fallback |

Native deprecated warning is exactly
`Warning: -headless is deprecated.  Use --headless instead.\n` for `-headless`.
Unknown flags, empty operands, `--`, attached `--convert-to=...`, and literal names
starting with `-` need dedicated parser controls; do not infer GNU getopt semantics.
Outdir omission needs explicit invocation VFS cwd resolution; never host cwd.

## Input/output/filter matrix

Native names below are verified XCU registry keys, not localized UI labels.
I/E means declared IMPORT/EXPORT, not conversion fidelity. Explicit filters pin
controls; inferred export must additionally resolve document service, type fragment
extension and preferred export filter. Do not choose solely by filename extension
or assume an explicit DOCX filter is the inferred preferred one.

| Input | Native document family | Explicit output extension/filter pairs intended for this family | Current product qualification |
| --- | --- | --- | --- |
| DOCX | Writer | docx:`MS Word 2007 XML`; odt:`writer8`; rtf:`Rich Text Format`; html:`HTML (StarWriter)`; md:`Markdown`; txt:`Text`; pdf:`writer_pdf_Export` | No soffice implementation; layout/model/export gates open |
| ODT | Writer | Same Writer outputs | ODF import/export and layout missing |
| RTF | Writer | Same Writer outputs | Existing Pandoc grammar is a reuse candidate, not Office parity |
| HTML | Writer/Writer-Web depends on import | Writer outputs with service validation; PDF may require `writer_web_pdf_Export` | HTML tree/resources/layout and service gates open |
| Markdown | Writer | Same Writer outputs; native `Markdown` declares I/E | Native registry capability distinct from Pandoc dialect; parity open |
| text | Writer, or forced Calc import | Writer outputs; Calc outputs only with explicit Calc import | Encoding/newline/import ambiguity controls required |
| PDF | Draw or explicitly qualified PDF import profile | pdf:`draw_pdf_Export` for Draw; other outputs only through independently admitted import/service | Import filter/type and fidelity not yet qualified; no PDF-to-Office reconstruction claim |
| PPTX | Impress | pptx:`Impress MS PowerPoint 2007 XML`; odp:`impress8`; pdf:`impress_pdf_Export` | Model/masters/notes/layout gates open |
| ODP | Impress | Same Impress outputs | ODF and presentation gates open |
| XLSX | Calc | xlsx:`Calc MS Excel 2007 XML`; ods:`calc8`; csv:`Text - txt - csv (StarCalc)`; pdf:`calc_pdf_Export` | Existing XLSX reader only; spreadsheet round-trip/rendering unqualified |
| ODS | Calc | Same Calc outputs | ODF and Calc gates open; reuse existing engine owner |
| CSV | Calc only with qualified detection/forced import | Same Calc outputs | Typed CSV import contract separate from export; spreadsheet gates open |

This matrix is closed by family: Writer-to-slide/workbook and Impress/Calc-to-Writer
or each other's family are unadmitted until a real loss-preserving bridge is qualified.
Each listed pair remains intended but unimplemented; unadmitted pairs must produce an
explicit unsupported-conversion diagnostic, never renamed bytes or extracted text
presented as a complete conversion. PDF input is an open prerequisite, not silently
removed. All non-PDF filters listed above declare I/E; PDF export filters declare E
only. Encrypted members, signatures, formulas and macros need separate capability
admission; an ENCRYPTION flag does not implement those capabilities here.

## Dispatch, outputs and status

Output name uses last source path segment and replacement extension under outdir.
Pin dotless/multi-dot/Unicode names, percent escapes and literal `:;|` names in VFS;
reject host/remote URL interpretation and preflight traversal, aliases and collisions.
Native sets Overwrite=true. Product may overwrite admitted destinations but must
preflight source/destination aliasing, output-output collisions and unsafe sheet
names. Document such safety differences independently of compatibility results.

Source-pinned stdout templates below terminate in LF. Native uses process text
encoding, so byte equality additionally requires pinned locale/encoding. `SOURCE`,
`TARGET`, `NAME`, `FILTER`, `MESSAGE` are substitutions, not captured output.

| Dispatch outcome | stdout source expectation | stderr source expectation | Status evidence |
| --- | --- | --- | --- |
| ordinary conversion | `convert SOURCE as a NAME document -> TARGET using filter : FILTER\n` | Empty in uncomplicated path; other layers/logging unqualified | Native process status unresolved |
| unknown service display name | Omits ` as a NAME document` | As above | Unresolved |
| existing ordinary target | Progress then `Overwriting: TARGET\n` | As above | Unresolved |
| CSV multi-target selector | Progress omits ` -> TARGET`; dispatcher suppresses Overwriting line | Calc may add diagnostics | Calc messages/process result need capture |
| source load fails | No conversion progress for that source | `Error: source file could not be loaded\n` | WithError set; final exit unresolved |
| no export filter at dispatch | No successful export | `Error: no export filter\n` | WithError set; other lookup path has additional source-specific text |
| storeToURL exception | Progress may already exist; not success evidence | `Error: Please verify input parameters... (MESSAGE)\n`, parentheses omitted if empty | WithError set; exit mapping unresolved |
| cat | Exported ReadLine content, each stdout line via endl; no ordinary progress | Load/temp/export failures remain possible | Exact byte/newline/process behavior unresolved |

NAME mappings include Writer, Writer/Web, Impress, Calc, Draw. FILTER display may
include its options suffix even though FilterName property strips that suffix.
Multiple files are dispatched individually; validate ordering, success before/after
failure, overwrite interactions and partial outputs. Trace Desktop/IPC final result
and attachment mode before assigning global native exit 0/1. A source WithError bit
is insufficient. Product proposed status contract: 0 only if every requested file
completes; 1 for conversion/resource/I/O failure; 2 for invalid or denied invocation.
These are product design targets, not implemented or native-qualified values.
Cancellation must follow the canonical shell contract; do not invent a competing exit
mapping. Already committed independent file outputs can remain after later failure;
failed/current outputs must not masquerade as completed exports.

## CSV and PDF option contracts

CSV export token positions (one-based): 1 separator/fixed-width, 2 quote separator,
3 encoding, 4 start-row placeholder, 5 column-info placeholder, 6 language placeholder,
7 QuoteAllText, 8 SaveNumberAsSuch, 9 SaveAsShown, 10 SaveFormulas, 11 RemoveSpace,
12 sheet selector, 13 EvaluateFormulas, 14 BOM, 15 endianness. Import uses a distinct
contract (`asciiopt.cxx`). Modern booleans accept literal lowercase `true` only.
Absent options construct UTF-8/comma/double-quote with SaveAsShown=false. Supplied
options start SaveAsShown=true; fewer than three tokens return incomplete defaults;
exactly four tokens use legacy numeric fourth SaveAsShown and QuoteAllText=true.
EvaluateFormulas defaults true when absent, false if present without literal true.

Calc parser accepts selector -1 (all), empty/0 (current), ASCII digits (one-based
positive); other strings produce sentinel -23. Dispatcher merely checks token index
11's numeric prefix for nonzero, so malformed selectors can print misleading
multi-target progress before Calc rejects them. Capture both layers. Out-of-range
must fail, not export a fabricated empty sheet. Multi-target names are
`base-sheetname.ext`; preflight VFS traversal/duplicate/sanitization collisions.
Quote separator/quote/LF/CR cells, double embedded quotes; UTF-8 BOM is opt-in,
native Unicode encoding emits BOM. Qualify context encodings, fixed-width,
displayed/raw values, formulas/cached values and error/empty/edit cells separately.
Implicit external-data/DDE/network/macros are denied; evaluation needs bounded
first-party semantics in the existing spreadsheet engine.

PDF JSON is interpreted only when FilterData is empty and FilterOptions starts
with `{` at its first character. Invalid JSON warns and falls back to profile settings
natively. Product instead validates a versioned explicit schema and rejects invalid
options before writing, with no persisted-profile fallback. `JsonToPropertyValues`
uses keyed `{type,value}` entries and supports string, boolean, float, long/short,
signed/unsigned integer widths and sequence types; property-tree string conversion
and native coercions are not equivalent to an arbitrary JavaScript object schema.
Admit each property's expected UNO type/range only after independent controls;
reject unknown types/properties and lossy/out-of-range values explicitly.

Source defaults/settings and renderer branches are pinned in
[safe-bash-soffice.md](safe-bash-soffice.md#office-filter-and-renderer-source-details).
SelectPdfVersion 0/unknown => PDF 1.7; 1/2/3/4 => PDF/A-1/2/3/4;
15/16/17/20 => explicit versions. PDF/A forces tagging/no encryption; A-1 removes
transparency. A-4 TODO prevents a standards-compliance claim from flags. PDF/UA
forces tagging/accessibility extraction and disables ReferenceXObject.
Constructor defaults: tagging/forms false; notes/bookmarks true; hidden slides/
SinglePageSheets false; lossy compression/resolution reduction/skip-empty-pages
true; viewer title true; encryption/signing false. Persisted configuration overrides
native defaults. Product defaults must be explicit, versioned and independently
qualified, including fonts/metrics/assets; no implicit last-export settings.

Nonempty PageRange replaces supplied selection with full document before native
range enumeration. Empty range/SinglePageSheets select all renderer pages. Notes
apply only to Impress without shape selection; ExportOnlyNotesPages controls normal
pass too. Zero renderer count fails. Hidden-slide numbering excludes preceding hidden
slides unless exporting them. Writer temporarily changes layout/whitespace/tracked
change visibility and restores it. Do not substitute qpdf's range grammar.

## Admission gates

Independent controls and fixture geometry are in
[compatibility-soffice.md](compatibility-soffice.md); they never import candidate
parser/default/filter logic to calculate expected outcomes. Implementation tests use
memory VFS/memfs, mocked capabilities, no LLM or host executable. TDD precedes code.

Require byte streams with retained/decompressed/input/output/asset/model/page/glyph/
work counters, per-file and total budgets, overflow checks and explicit cancellation
through load/layout/export/publication. Budget defaults and units must be versioned
before implementation admission; this research does not fabricate measured limits.
Cleanup must release streams, buffers, temporary VFS entries and invocation state
on success, failure, cancellation and publication error, retaining realm ownership
and replay invariants. Layout nonconvergence must diagnose failure; never publish
partial pages as a complete document.

Macros/scripts/OLE may only remain inert data under an explicit preservation policy;
unsupported active content is rejected. External links/images cannot fetch implicitly.
Fonts are licensed explicitly supplied/bundled assets with deterministic metrics;
no ambient fonts, HarfBuzz, native/WASM, downloads or dependency fallback. Prove
shaping/layout/table/pagination correctness, not text equality or PDF existence.
CLI and SDK outputs, statuses, option validation and cancellation must match.
Packed-consumer runtime/declaration/asset checks remain a distinct wiring gate.

## Fresh source receipts

Fetched pinned raw source on 2026-09-20; XCU fragments parsed as XML with an explicit
registry namespace wrapper. These hashes pin inspected bytes, not executable behavior.
Earlier layout source receipts remain in the original soffice plan. No source code or
external library was incorporated into runtime. MPL-2.0/Apache notices require review
before any adaptation.

| Pinned source | SHA256 |
| --- | --- |
| [desktop/source/app/cmdlineargs.cxx](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/desktop/source/app/cmdlineargs.cxx) | `9182fdefd320358da187a2f17d26a1debdb220b57f0a3f4aab9aa2ed953569e8` |
| [desktop/source/app/dispatchwatcher.cxx](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/desktop/source/app/dispatchwatcher.cxx) | `07fd74456c82207e1ca68659987f8b70f900337d756189e8b570a4c6159ed809` |
| [sc/source/ui/dbgui/imoptdlg.cxx](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/sc/source/ui/dbgui/imoptdlg.cxx) | `edc4152351ccdddbda61d19163fa3f65a07d83e06d8dcf8db758af5eabe401a1` |
| [comphelper/source/misc/sequenceashashmap.cxx](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/comphelper/source/misc/sequenceashashmap.cxx) | `1879825408358ad02350aec863a4df27537faddb084fee01d792372525f3f87c` |
| [filter/source/config/fragments/filters/MS_Word_2007_XML.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/MS_Word_2007_XML.xcu) | `a73b06db0b4039dfbf463445628b166fd3bed29bac823b19850fda43515193e2` |
| [filter/source/config/fragments/filters/writer8.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/writer8.xcu) | `f24380cbe640799b3a3aa8e766252b21a7c44a883f02b516d69929cd3f3d234e` |
| [filter/source/config/fragments/filters/Rich_Text_Format.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/Rich_Text_Format.xcu) | `736a566caf4d6eb363a1228b25401532657fe6ff193476f3201bfac15f823c70` |
| [filter/source/config/fragments/filters/HTML__StarWriter_.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/HTML__StarWriter_.xcu) | `8e658a114abd423af01b56b005c61be946e2c04a8bc012dedf66bc035b31ee35` |
| [filter/source/config/fragments/filters/Markdown.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/Markdown.xcu) | `fcf5f7156aea37ec778261e12d4df798a88f889848b31c8f3f0451557393678c` |
| [filter/source/config/fragments/filters/Text.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/Text.xcu) | `e3a314dc7c991cba8fb4d40f0953b5a9645988b32bf107fbb2d06c41141902db` |
| [filter/source/config/fragments/filters/writer_pdf_Export.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/writer_pdf_Export.xcu) | `77a56f55bc5f2b64bb04cce05d52b2e27cd377e56d71327a2ee42e8eaf6ab781` |
| [filter/source/config/fragments/filters/writer_web_pdf_Export.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/writer_web_pdf_Export.xcu) | `ec2be77a19da91ec1b8d96abe4686ea1924b0b043b3280468a44c8f6abb18996` |
| [filter/source/config/fragments/filters/impress_MS_PowerPoint_2007_XML.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/impress_MS_PowerPoint_2007_XML.xcu) | `f911ee49f9248e37861e705e14f50b418647afb3fd0bc474ca0ca32fb1a332a6` |
| [filter/source/config/fragments/filters/impress8.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/impress8.xcu) | `5b2207ef7786a9d912d6c82703e25375b2f60089fb80e999c6ae3691a44bf3b0` |
| [filter/source/config/fragments/filters/impress_pdf_Export.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/impress_pdf_Export.xcu) | `0387e2f1022881e2c12b12c4d7694eb809338711153f54308451894f60b39331` |
| [filter/source/config/fragments/filters/calc_MS_Excel_2007_XML.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/calc_MS_Excel_2007_XML.xcu) | `dbe5b11b635ad64075da0c689afae9dfbdc95d20a104629f9041bda76f32da15` |
| [filter/source/config/fragments/filters/calc8.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/calc8.xcu) | `83d2422eea7a956854199a5fa74e1684f396faaf33d498c0ece9a940f42ad571` |
| [filter/source/config/fragments/filters/Text___txt___csv__StarCalc_.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/Text___txt___csv__StarCalc_.xcu) | `183cb75b35888e35bdd90b0007c2df6bde756d37a6214bd975bb9d1cf1e45926` |
| [filter/source/config/fragments/filters/calc_pdf_Export.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/calc_pdf_Export.xcu) | `ff1cde922c0a5d32add0a2bcdc8e7f9a15aeb2c72a4928092867d74b5d3d2fcb` |
| [filter/source/config/fragments/filters/draw_pdf_Export.xcu](https://github.com/LibreOffice/core/blob/d17755172ac96e54e3f10f35dd1b1680f0ef84bd/filter/source/config/fragments/filters/draw_pdf_Export.xcu) | `30fd57bfb818d146b74ecc6f0815dbec58a2600576bec42c461e5111ddda703e` |
