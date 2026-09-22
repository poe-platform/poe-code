# Independent soffice compatibility controls

Companion to [source contract and matrix](safe-bash-soffice-research.md).
Status: source expectations pinned; **zero qualified native conversion cells**.
No fixture described below has a captured native conversion transcript or accepted
layout screenshot in this task. Specifications below are acceptance inputs, not
fabricated native evidence. Implementation, rendering, standards and status gates stay open.

## Capture procedure

1. Obtain a control binary whose reported build/version is recorded separately from
   LibreOffice/core `d17755172ac96e54e3f10f35dd1b1680f0ef84bd`. Record binary/source
   mismatch explicitly. Installed manifest `26.8.0.3` alone is insufficient. Confirm
   startup reaches main; dyld failure, timeout, missing binary and unavailable assets
   are blocked cells, never passes or conversion failures.
2. Use a unique development-only UserInstallation, no existing-process attachment,
   pinned locale/timezone/fonts and an explicitly recorded clean or stored-settings
   profile. Record hashes/licenses/versions of fonts, dictionaries and image assets.
   Deny network; never run macro, DDE, OLE, script or external-data content. Capture
   source/target directory state. Do not terminate unrelated Office processes.
3. Run every argv below with literal argv array operands, never shell interpolation.
   Capture raw stdout, stderr, process exit/signal and complete created/modified files,
   hashes and sizes. Capture startup warnings separately without deleting them from
   exact comparison. Bound wall time and resources; termination is blocked evidence.
4. Establish clean-profile and intentional persisted-setting controls separately.
   Do not normalize away known PDF default differences. Compare CLI and SDK candidate
   paths against independent expected records; no candidate registry/parser may
   generate its own oracle. Do not commit mutable capture scripts as unit tests.
5. Open original documents and exports in pinned independent viewers; capture full
   page/slide/sheet screenshots, media boxes, text/image/table geometry and selection
   mappings. Pin screenshot scale, rasterizer and tolerance before comparison. Record
   standards-validator versions for each PDF/A and PDF/UA profile. Renderer equality,
   standards checks, byte/status equality and safe-product differences are separate.
6. Keep temporary logs/evidence in the task's out directory; retain durable receipts
   in docs/plans before purging task-owned scratch. Record required but unavailable
   cells and proceed with useful source inspection, without declaring native parity.

## Fixtures

Simple byte fixtures are fully defined here. Structured fixture rows are authoring
specifications: commit their original bytes and SHA256 before executing acceptance;
no current binary fixture/hash/screenshot is claimed. OOXML/ODF authoring must use
independent tooling/manual originals, not the candidate exporter being qualified.
No ambient fonts: geometry fixtures use a named, hashed, licensed supplied font.

| ID / VFS path | Input definition | Required artifact checks |
| --- | --- | --- |
| T0 `/src/empty.txt` | zero bytes | Empty-renderer/empty-text behavior, no fabricated page claim |
| T1 `/src/a.txt` | hex `416c7068610a426574610a` (Alpha LF Beta LF) | txt/cat exact bytes and final terminator |
| T2 `/src/no-final.txt` | hex `416c706861` | cat final LF source expectation versus exact capture |
| T3 `/src/crlf.txt` | hex `410d0a420d0a` | Line decoding/CRLF differences, chunk boundaries |
| T4 `/src/unicode.txt` | UTF-8 `café العربية` followed by LF | Encoding, bidi, shaping, no ASCII substitution |
| R1 `/src/a.rtf` | ASCII bytes `{\rtf1\ansi Alpha\par Beta}` | RTF import/style/paragraph versus txt/PDF outputs |
| H1 `/src/a.html` | UTF-8 `<html><body><p>Alpha</p><p>Beta</p></body></html>` | HTML/Writer service and paragraphs |
| M1 `/src/a.md` | UTF-8 `# Alpha\n\n**Beta**\n` with notation `\n` decoded to LF | Native Markdown dialect/style round-trip |
| C1 `/src/a.csv` | UTF-8 `name,value\n"a,b","x""y"\n` with LF notation decoded | Independent CSV quoting/import/export |
| C2 `/src/formula.csv` | UTF-8 `label,value\n"=1+2",3\n` with LF notation decoded | Import typing/formula policy; no implicit execution |
| W1 `/src/a.docx`, `/src/a.odt` | Same authored two-paragraph document, explicit A4 210×297 mm, 20 mm margins, 12 pt supplied font, 14 pt line spacing | Page count, baseline/paragraph geometry, styles, semantic preservation |
| W2 DOCX/ODT pair | Numbering, sections/columns, page styles, headers/footers, foot/endnotes, fields, tracked edits/equations | Preserve model plus rendered geometry; edits visibility restored |
| W3 DOCX/ODT pair | Explicit page/column before/after; keep chains in body/footnotes/cells; split floating anchors; last-table-row same/different section | Boundary overrides and ignored keep branches |
| W4 DOCX/ODT pair | Unsplittable row taller than page; row containing section; repeated header taller than page; first body row cannot fit | Forced split/blocked section/header reset or omission/resumption |
| W5 DOCX/ODT pair | Row spans, nested unsplittable rows, minimum-height floating table, growing footnote and keep chain | Backtracking/rescue/retry; complete pages or explicit nonconvergence failure |
| W6 DOCX/ODT pair | Paragraph/column/page/spread hyphenation zones; blank/fullblank/six-per-em spaces; long final word/URL; footnote at line boundary | Dictionary/language suppression/underflow; no ASCII splitting substitute |
| G1 DOCX/ODT pair plus font data | Fractional advances and negative half-tie offsets, subpixel on/off | C++ round ties away from zero for each scaled advance/offset; JS Math.round is insufficient |
| G2 DOCX/ODT pair plus font data | Ligatures with matching and mismatched OpenType caret counts; mixed RTL styles inside grapheme | Caret widths/offsets/RTL reversal/even fallback, total advances and last logical remainder |
| G3 DOCX/ODT pair plus font data | Mongolian preceding NNBSP, missing glyph cluster fallback, script/bidi/language/features, variable/vertical font metrics | Grapheme fallback/range clamp and secondary character-cluster shape |
| G4 DOCX/ODT pair | Minimum glyph scaling/letter spacing at bound, COMPLETE_STRING result, long URL later line parts, nonconvergent profile | Width expansion formula and original-cut retention; reject invalid/nonconvergent profiles |
| P1 `/src/a.pptx`, `/src/a.odp` | 3 slides, explicit 254×190.5 mm, one hidden middle slide, masters/theme, notes each slide, image/table/chart | Original/export slide geometry, notes passes, hidden-slide numbering; transitions inert |
| S1 `/src/book.xlsx`, `/src/book.ods` | Three sheets `One`, `Two`, `Three`; displayed/raw numbers, cached formula/error/empty/edit cells, print areas and page breaks | CSV selector/files/content; PDF page/sheet geometry; cached versus bounded recompute |
| S2 workbook pair | Duplicate/special sheet names and formula/external-data relationships | Naming collision/path safety, inert external content; native/product difference recorded |
| D1 `/src/a.pdf` | Independently authored two-page PDF with supplied embedded font, text/vector/image/link; explicit media boxes | Draw/import filter qualification; geometry/resources before any PDF-input claim |
| X1 OOXML/ODF set | Traversal/duplicate relationships, ZIP bombs, encrypted members, malformed XML, remote images, macro/OLE/DDE metadata | Bounded decode/denial/inert preservation; zero host/network effects |

## Invocation and output controls

Unless overridden, cwd is `/src`, outdir is `/dst`, empty before invocation.
Use explicit filter operands below, then repeat each admitted family with inferred
filter to exercise service/type/preferred lookup. `P(S,T,N,F)` means the exact
source-pinned line `convert S as a N document -> T using filter : F` plus LF;
`Q(S,N,F)` is that line with arrow/target omitted. These are source templates,
not captured bytes. Ordinary uncomplicated stderr is expected empty, but logging
and startup bytes remain to be qualified. **Every native numeric exit is pending**;
record Desktop/IPC result, do not replace pending with a guessed 0/1.

| Cell | Literal argv following soffice | Expected source behavior / files / diagnostics |
| --- | --- | --- |
| A01 | `--headless --convert-to txt:Text --outdir /dst /src/a.rtf` | P(`/src/a.rtf`,`/dst/a.txt`,Writer,Text); text export content still native-pending |
| A02 | `--convert-to pdf:writer_pdf_Export --nologo --outdir /dst /src/a.docx` | Neutral flag accepted; `/dst/a.pdf`, P with Writer and writer_pdf_Export |
| A03 | `--outdir /dst --convert-to pdf /src/a.docx` | Wrong-event parser message from source contract; no accepted export |
| A04 | `--convert-to` | Missing-operand message; outer desktop stderr formatting/status pending |
| A05 | `--convert-to pdf --outdir` | Missing-outdir message; no accepted export |
| A06 | `/src/a.docx --convert-to txt:Text --outdir /dst /src/a.rtf` | First file open-list; only second conversion-list; product denies open request |
| A07 | `--convert-to pdf /src/a.rtf --convert-to txt:Text --outdir /dst /src/no-final.txt` | Both conversion-list files use final txt:Text; ordered files `/dst/a.txt`, `/dst/no-final.txt` |
| A08 | `-headless --convert-to txt:Text --outdir /dst /src/a.rtf` | A01 plus exact deprecated warning on stderr |
| A09 | `--convert-to txt:Text --outdir /dst /src/a.rtf /src/missing.rtf /src/no-final.txt` | Progress for successful loads; source-load error for missing; verify continuation/order/partial outputs and global result |
| A10 | A01 with preexisting `/dst/a.txt` | P then `Overwriting: /dst/a.txt` LF; overwrite content; stdout alone not proof of store success |
| A11 | A01 with output write denied | Progress may precede store error; `Error: Please verify input parameters...` plus optional exception; no complete failed output |
| A12 | `--convert-to unknown --outdir /dst /src/a.docx` | No-export-filter lookup/dispatch path; distinguish source-specific and generic diagnostics |
| A13 | `--cat /src/a.txt /src/no-final.txt /src/crlf.txt /src/empty.txt` | No conversion progress; ReadLine/stdout terminators/order/temp cleanup independently captured |
| A14 | `--infilter=Text:one:two --convert-to txt:Text --outdir /dst /src/a.txt` | Forced descriptor name Text, remaining options one:two; validity requires actual import filter, not parser acceptance |
| A15 | A01 with dotless/multi-dot/Unicode names and names containing `:;|` | Last-segment replacement, no shell interpretation; byte/path admission safety recorded |
| A16 | A01 with source/output same inode/alias or two same basenames | Native effects pending; product preflight rejects destructive alias/collision |
| A17 | Neutral flags, --, empty operand, attached convert option, unknown flag, leading-dash filename, repeated outdir | Explicit parser captures required; no inferred getopt grammar |
| A18 | Listener/printing/UI/profile/script-cat invocations | Native unsafe operations not run; source/inert inspection only; product explicit denial/unimplemented status |

Run W1/R1/H1/M1/T1 against every Writer output in the source matrix. Run P1
against every Impress output, S1/C1 against every Calc output, and D1 only after
qualified import/service controls. Record all intended cells, including blocked
ones. No successful diagonal round-trip qualifies all off-diagonal pairs.

CSV controls use
`--convert-to 'csv:Text - txt - csv (StarCalc):OPTIONS' --outdir /dst /src/book.xlsx`
where quotes here group one literal operand, not shell quoting behavior.
Define modern OPTIONS as exactly 15 comma-separated tokens:
`44,34,76,1,,0,false,true,false,false,false,SELECTOR,true,false,0`.
Verify encoding token 76 against native charset mapping before byte qualification.

| CSV group | Variants | Independent expected checks |
| --- | --- | --- |
| C01 | absent options, empty, 2 tokens, 3 tokens, exactly `44,34,76,0` or `44,34,76,1` | Constructor versus supplied/legacy defaults, QuoteAllText, SaveAsShown |
| C02 | SELECTOR empty/0/1/2/-1/4/abc/1x/-2 | Current base file versus base-sheetname files; invalid/out-of-range diagnostics; dispatcher numeric-prefix differs from Calc validity |
| C03 | Toggle each modern boolean true/false/TRUE/1/empty; omit versus empty token 13 | Literal true semantics; EvaluateFormulas absence differs from presence |
| C04 | Change separators/quotes, LF/CR/embedded quotes, Unicode, BOM token14, Unicode encoding, endianness | Exact byte quoting/encoding/BOM; context separator round-trip |
| C05 | Display/raw numbers, cached/formula/error/edit/empty cells; fixed-width | Content semantics separately qualified; no uncontrolled formula evaluation |
| C06 | Multi-sheet preexisting files/colliding names/cancellation | Q progress/no dispatcher Overwriting; Calc per-sheet messages and VFS publication effects captured |

PDF controls use each family-specific PDF filter with an explicit typed JSON operand.
Baseline example property: `{"SelectPdfVersion":{"type":"long","value":"17"}}`.
Record complete explicit product settings before comparison, not only this property.

| PDF group | Variants | Independent expected checks |
| --- | --- | --- |
| F01 | Empty/options absent, valid typed JSON, leading whitespace before `{`, malformed JSON, unknown type/property, numeric coercion/range | Native JSON trigger/profile fallback versus product deterministic validation |
| F02 | Version 0/unknown/1/2/3/4/15/16/17/20; encryption/transparency/tagging combinations | Header/features and independent standards validation, not flag existence; A-4 unresolved TODO |
| F03 | PDFUACompliance, ReferenceXObject, forms/bookmarks/notes/image settings | Tag/accessibility semantics and independent profile admission |
| F04 | Selection with/without PageRange, empty range, invalid/native ranges, SinglePageSheets | Native enumerator; full-document replacement; no qpdf grammar assumption |
| F05 | P1 hidden slides, notes-only versus normal+notes, shape selection | Counts/order/numbering and actual screenshot geometry |
| F06 | Empty renderers, tracked changes/web layout/hidden whitespace, cancellation/store failure | Failure/restored invocation state, no incomplete complete-looking output |

## Layout and isolation acceptance

Each W/G branch requires original DOCX and ODT screenshots plus exported screenshots,
page counts, bounds, baseline/table/image/footnote coordinates and caret/cluster data.
Keep source-only branch ownership separate from actual arithmetic qualification.
C++ std::round negative halves, individual scaling, caret-count matching, RTL width
reversal and last logical rounding remainder must be explicitly tested before claiming
compatibility. No arithmetic is presently qualified; invalid/nonconvergent profiles
are deliberately rejected in the product design rather than silently truncated.
`layact.cxx` 10000 outer/20 local passes are not a comprehensive global work bound.

Memory-VFS implementation tests must force each budget boundary, abort before/during
load/layout/export/publication, failed writes and cleanup. Mock explicitly supplied
capabilities; assert no host executable/fs/network/font access. Exercise both shell
CLI and SDK and installed artifact routes, including canonical carrier/error identity,
realm/replay invariants and bounded producer chunks. These tests verify implementation
safety; they do not replace independent native/layout/standards controls.
