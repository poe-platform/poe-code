# ssconvert visual compatibility verification

Executed 2026-09-21 against the existing TypeScript ESM candidate. This was a
visual audit; no runtime code, tests, exports or README files were changed.
Procedure: `docs/plans/ssconvert-safe-bash-qa.md`, visual compatibility procedure.
Reduced hashes, channel comparisons and PDF measurements are in
`visual-compatibility-measurements.json`. Unsupported and unmeasured cases are
not passes.

## Qualification and execution

Fresh official Gnumeric 1.12.61 source was acquired only into owned out scratch.
Archive SHA-256 matched
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`;
the archive member `src/ssconvert.c` was inspected, including stderr list printing.
Captured reference profile SHA-256 remained
`f5767a61ed1356d95600370135bf3afce808c17aabc0c633d881e14578a8347e`.
Dependency/plugin/locale qualification remains that of the captured profiles,
not a newly qualified macOS runtime. Docker API was unavailable. No fresh native
process ran. Native utilities and PyMuPDF 1.26.5 were isolated QA capabilities;
neither was a product dependency or fallback.

The maintained uncached closure passed:
`npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`
(18 builds, including Safe Bash postbuild). Built public domain index hash:
`d0c56a1047c278ad9a2115be72a273eaefacbf42561ed933fd27799b514a17e6`;
built command hash:
`b831e7617095fea7d0a50c205328c4859a0afcd7eb05c693a174fa8a74fe25f8`.
No unit suite or runtime lint was rerun for this documentation-only audit; the
build is not a test-suite pass. Markdown formatting and whitespace were checked.

## Terminal observations

Inspection of src CLI definitions found no poe-code ssconvert forwarding route.
Consequently no root `poe-code ssconvert` subcommand was invoked or invented, and
no applicable route required `npm run screenshot-poe-code`. Actual public built
Shell, MemoryFileSystem and ssconvertCommands invocations were captured with
`npx tsx scripts/screenshot.ts --no-header -o <owned-image> -- node --input-type=module -e <inline-session>`.
A PTY recapture used 150 columns and 110 rows. Separate raw channel files were
retained until reduction. Harness status/channel annotations were not command
bytes. The first merged-channel capture reordered stderr relative to harness
annotations; it is not evidence of product write ordering. Raw channels and a
separate explicitly labeled channel rendering resolved that ambiguity.

| Invocation                            | Exit | stdout bytes | stderr bytes |
| ------------------------------------- | ---- | ------------ | ------------ |
| `ssconvert --help`                    | 0    | 1475         | 0            |
| `ssconvert --list-importers`          | 0    | 0            | 1277         |
| `ssconvert --list-exporters`          | 0    | 0            | 1775         |
| `ssconvert --not-a-real-option`       | 1    | 0            | 112          |
| `ssconvert /missing.xlsx /result.csv` | 1    | 0            | 43           |

Images were inspected with view_image. Option descriptions and list separators
align; errors are readable and have no product styling/spinners. One long help
description clipped in the terminal renderer, including the PTY recapture. An
explicitly labeled QA rendering wrapped raw lines at 110 columns and exposed the
complete text; this was a presentation transformation, not a product fix or
exact-layout pass. Product help bytes were unchanged. The renderer limitation
remains observable in unwrapped captures.

Against historical `reference-profile.json` captures, help stdout differs only
in invoked program path: replacing `/opt/ssconvert-reference/bin/ssconvert` with
`ssconvert` gives exact equality. This is normalized equality, not exact-byte
equality. Help stderr and list stdout are exactly empty in both candidates.
Importer stderr adds `Gnumeric_psiconv:psiconv | Psion (*.psisheet)`; exporter
stderr adds `Gnumeric_GnomeGlossary:po | Gnome Glossary PO file format` (the actual
bytes contain padded columns). Remaining list lines/order match the retained
profile. These are concrete plugin-profile mismatches, not qualified list passes.
Unknown option diagnostics read `Unknown option --not-a-real-option` followed by
the upstream help suggestion. Missing input reads
`E /missing.xlsx: No such file or directory`. Those two exact operands have no
fresh native differential qualification here.

## Printed pages and graph images

Actual command and SDK PDF bytes matched for three fixtures through injected
memory byte I/O. C/UTC and limits were explicit: 1,000,000 input bytes,
4,000,000 output bytes, 10,000 cells, 10 sheets, 100,000 operations and
10,000,000 workbook work units. SDK cancellation used an injected AbortSignal;
this audit did not stress cancellation, replay, isolation or budget boundaries.

The original empty graph fixture has one One sheet, one graph named graph,
absolute anchor A1:A1, offsets `0 0 71 35`, empty GogGraph and no cells.
`ssconvert --export-graphs -T png /graph.gnumeric 'graph-%n.png'` returned 0 with
empty channels and produced graph-0.png, visually inspected as blank/black.
The PNG measures 98 by 48 pixels (18,932 bytes). Its object PDF with
`object=graph paper=fit` is one 71 by 35 point page. This
measures an empty object only; there is no paired native image for this original
fixture. Axes, labels, legends, plotted series and graph font fidelity remain
unmeasured.

Retained original workbook fixture SHA-256:
`8f8cc91e7333fabc8d04656996df7411a1d8ca1b31a69843c70d634cec4889ae`.
It contains One and Two, each with 90 row labels. Actual command:
`ssconvert -T Gnumeric_pdf:pdf_assistant -O 'sheet=One sheet=Two' /workbook.gnumeric fd://1`.
The current PDF and retained `out/ssconvert-pdf/native/workbook.pdf` both have four
A4 portrait pages, 595.2755737304688 by 841.8897705078125 points as parsed by
the same QA renderer. Per-page extracted text tokens match: One rows 0–46,
One rows 47–89, Two rows 0–46, Two rows 47–89, with centered sheet headers and
Page 1 through Page 4 footers. All eight current/native page images were inspected
with view_image. There was no page-edge clipping in these pages.

Visual fidelity does not match. Current PDF embeds JetBrainsMono-Regular;
retained native embeds DejaVuSans. The current labels are visibly wider and
start farther left; glyph shape, spacing and header/footer appearance differ.
The renderer is shared, but the font profiles are not. This is a validated
rendering mismatch, not evidence that pagination/font compatibility is complete.
The native capture is historical and linked to the previous PDF QA records;
its process/profile was not freshly reproduced.

Retained painted graph fixture SHA-256:
`927ebe8d6f16a7bcc21aa8b5ab021cf5369b5951a5ceed21a48c3a99070e5735`.
With `object=same paper=fit`, current command/SDK produce a red 123 by 35 point
single-page PDF, visually inspected. The retained native painted.pdf has an A4
page with a red rectangle at an inset origin, so it is a different print-option
case and was excluded from paired fidelity claims. The retained native 0.pdf
fits 123 by 35 points but came from a different unpainted fixture, likewise
excluded. File-name similarity is not fixture or option equivalence.

## Remaining coverage and delivery

Fresh pinned native comparisons, qualified graph themes/plots/axes/labels,
matched font data/shaping, landscape and custom-paper differential rendering,
repeated titles, hidden rows/columns/sheets, fit scaling, manual page breaks,
gridlines/headings, merged cells, borders/fills, rotation/wrapping and locale
variations were not measured in this run. Historical records do not fill these
cells automatically. Byte-order/replay, realm ownership, host isolation and
resource invariants were not newly qualified. No speculative repairs or
screenshot tests were added; the pre-implementation TDD and post-implementation
stress/fix-agent gates were not activated because no implementation occurred.

Owned temporary evidence was reduced into these documents and measurements,
then only `out/ssconvert-visual-compatibility-qa` was purged. Other workers' scratch
and edits were preserved. No local commit, remote-main delivery, push or release
occurred.
