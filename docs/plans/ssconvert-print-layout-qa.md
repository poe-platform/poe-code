# Print layout QA

Target released Gnumeric 1.12.61, official archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Primary source remains in `out/ssconvert-lifecycle`; owned temporary captures
go in `out/ssconvert-print-layout`. Native ssconvert is a separate QA oracle.
Do not push, publish, or edit README files.

## Procedure

1. Authenticate the archive and extracted print source against archive members.
   Authenticate the existing native binary and dependency/font profile against
   `docs/ssconvert/chart-rendering-verification.json`. Use Docker context colima,
   container ssconvert-statistics-qa and its explicitly recorded prefix. Capture
   current plugin listings, locale C, timezone UTC and DejaVu Sans font identity.
2. Use original small inline workbooks with explicit 200-point columns,
   240-point rows, Letter paper and 72-point margins. Print four-by-four cells,
   then hidden rows, repeated titles, landscape, fit, manual breaks and centering.
   Keep invocation HOME/XDG roots task-specific. Capture actual exit status and
   stdout/stderr bytes. Inspect native PDF page geometry and images.
3. Test layout geometry in memory with explicit point data. Include the initial
   grid line, partially passed title ranges, breaks before zero-based indices,
   oversized cells, independently scaled axes, shared fit scale, formula display,
   headings and both page orders. No native utilities or disk writes in unit tests.
4. A different agent stresses and fixes the implementation using failing cases.
   Root owns exports, integration, documentation and Git. Do not count helper
   geometry as workbook PDF parity or treat unmeasured rendering as passing.
5. Run selected maintained uncached workspace build closure, ssconvert unit and
   lint routes, and safe-bash integration checks if its binding changes. Record
   verified coverage and all remaining mismatches in the verification document.
6. Inspect both native and product images where a scene renderer exists. Retain
   the absence of a product workbook painter as an open gate; a geometry diagram
   does not satisfy text/glyph/object screenshot parity. Purge only owned scratch
   after reducing evidence.

## Source field inventory

`src/print-info.h`, struct GnmPrintInformation, defines the following fields.
`src/xml-sax-write.c:335` identifies native XML serialization; this inventory
does not assert product codec round-trip fidelity.

| Native field | Representation / purpose |
| --- | --- |
| scaling.type | percentage or fit pages |
| scaling.percentage.x/y | separate calculated scales; XML stores x only |
| scaling.dim.cols/rows | zero means unconstrained page count |
| edge_to_below_header / edge_to_above_footer | body top/bottom edges |
| desired_display.top/bottom/left/right/header/footer | display units, separate from point geometry |
| repeat_top / repeat_left | repeated range expressions |
| print_across_then_down | page traversal order |
| center_vertically / center_horizontally | body centering |
| print_grid_lines / print_titles | grid and axis headings |
| print_black_and_white / print_as_draft | paint modes |
| print_even_if_only_styles / do_not_print | extent and sheet admission |
| comment_placement / error_display | comment/error print policies |
| page_breaks.h/v | row/column breaks with position and none/manual/auto/data-slice type |
| header / footer | left/middle/right format strings |
| start_page / n_copies | numbering and copy settings |
| printtofile_uri / print_range | destination and selected print range |
| page_setup | GTK paper size, orientation and margins; also defaults-loaded flag |

Header/footer rendering additionally needs sheet identity, page/pages,
date_time/date conventions, page_area and top_repeating. Workbook paths depend
on visibility, print area/named expressions, selection, row/column defaults,
hidden axes, merges, styles, formatted values, objects and formula display.

## Current per-codec preservation audit

These are inspected product code paths, not completed native round-trip gates.

| Codec | Current preservation path and gaps |
| --- | --- |
| Gnumeric XML compressed/uncompressed | Retains schema-filtered PrintInformation (`gnumeric.ts:403,585`). Units, margins, scale, repeats, flags, order, paper, headers, breaks and print range have schema entries. Native draft value is absent from current schema attributes. start_page/copies are not emitted by native XML writer. Reverse orientation loses reversal in native XML. |
| XLSX variants | `xlsx-metadata.ts` translates margins, scale, order, orientation, Letter/A4, monochrome/draft, comments/errors, odd headers/footers and breaks. `xlsx-write-metadata.ts` emits a subset and empty printOptions. Other paper codes, even/first headers, centering, grid/headings, copies and numbering are not demonstrated. Raw metadata retention is distinct from interoperable preservation. |
| XLS BIFF variants | `biff-metadata.ts` translates print flags, setup, margins and headers. `biff-write-metadata.ts` writes subset setup/header records. Full break/title/area/custom-paper/numbering round trips remain unmeasured. |
| ODS strict/extended, SXC read | `odf-metadata.ts` translates orientation, margins, scale and repeated header rows. `odf-write-styles.ts:130` emits orientation, four margins and scale; extended axis fit and strict total-page fit differ. Headers, paper, breaks, numbering, flags and repeat fidelity remain incomplete. |
| SpreadsheetML | Full native print-field preservation remains unmeasured; no parity claim. |
| Text/CSV/TSV, DIF, SYLK, HTML, LaTeX, roff, DBF, legacy importers | Cell/style capabilities do not demonstrate print-setting preservation. Per-format native loss/default behavior remains unmeasured. |
| PDF | Declared service has no built-in workbook writer. Page geometry helpers are not PDF rendering support. |

## Completion gates

Workbook print selection/admission and extent resolution, codec interoperability,
complete GTK paper catalog/custom syntax, explicit licensed font data, Pango
shaping/metrics/wrapping/rotation, formatted text, styles/merges/borders/fills,
objects, gridlines/headings paint, headers/footers/date/locale expansion, page
numbering policy, PDF serialization and actual command/SDK workbook export
remain required. Unsupported and unmeasured cases must remain open.

## Executed evidence (2026-09-21)

Archive hash passed; extracted print.c, print-info.c/h, print-cell.c and
xml-sax-write.c match authenticated archive members byte for byte. Native
binary SHA-256 `104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`
and DejaVuSans.ttf SHA-256
`57f73e11f51999432bf7ab22ce55b6f945d5eca1bf824404cfa9ec2e3718c84e`
match the existing chart-rendering native QA profile. This is that separate
profile, not a requalification of reference-profile.json. Importer/exporter
listings succeeded under task-local HOME/XDG roots, LC_ALL=C, LANG=C, TZ=UTC
and the recorded prefix/library/schema paths. Dependencies and plugin hashes
are linked from that profile; a fresh full linked-library/plugin hash capture
was not performed for this task.

Five original four-by-four native PDF fixtures exited 0 with empty stdout and
stderr. Native and product geometry page counts were respectively ordinary 4,
hidden-row 4, repeated-first-row 6, landscape 8 and fit-one-page 1. PDFKit
extraction independently verified expected per-page cell membership for all
23 pages, including repeat and hidden behavior. It does not validate glyph,
paint, wrapping or other PDF fidelity. Native Letter media boxes measured
611.999983 by 791.999983 points (swapped for landscape); product explicit paper
inputs were 612 by 792. Catalog conversion precision remains unimplemented.
The repeated-title native first-page PNG was inspected at 612 by 792 pixels.
There is no product workbook scene/image, so the paired screenshot gate is open.
An attempted ImageMagick PDF rasterization failed because Ghostscript was
absent; successful PDFKit inspection is a separate QA renderer, not the pinned
Gnumeric rendering engine or a product capability.

TDD first reproduced empty page output before implementation. The different
stress agent added eight source-derived failing regressions and repaired the
initial grid-line allowance, hidden versus visible zero-height axes,
data-slice breaks, negative centering, formula-display centering, invalid page
numbers and invalid work charges. Root added failing underflow and cancellation
precedence regressions before fixes. All 19 print tests pass in memory, without
native utilities or filesystem changes.

Final maintained checks passed:

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  selected declared dependency closure, three fresh builds.
- `POE_CHECK_CACHE=0 npm run test:unit --workspace=@poe-code/ssconvert`:
  266 files, 5,633 tests passed, fresh package invocation.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint and both production
  and test TypeScript checks passed.

The attempted root unit route with `--workspace` was rejected as an unsupported
selector before tests ran; it is not a passing check. The maintained package
route above was then used. No safe-bash binding was changed and no workbook PDF
writer was installed. Public geometry exports have build/type coverage only;
full virtual-command print integration is still required. No Git commit,
push, publication or README edit was made. Source notice records GPL origin.

Additional gaps identified by independent stress are oversized-cell warning
diagnostics, stored automatic-break mutations, RTL centering and workbook-level
selection/clamping. Geometry supports supplied row/column ranges, custom point
paper sizes, repeat ranges, explicit breaks, margins, scale/fit, headings space,
formula space, orientation, centering, traversal and caller-supplied numbering;
it does not resolve these from native workbook paths yet. This task remains
incomplete and must not be marked PDF parity or print-layout completion.
