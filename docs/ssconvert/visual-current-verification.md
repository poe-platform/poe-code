# Current ssconvert visual audit

Executed 2026-09-21 using the visual procedure in
`docs/plans/ssconvert-safe-bash-qa.md`. This follow-up preserves the earlier
`visual-compatibility-verification.md`. No implementation, tests, exports, README,
commit, push or publication changed. This is measured partial compatibility.

## Candidate and oracle

Node 22.22.2; dirty working tree based on Git
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`.
`visual-current-measurements.json` records entry hashes, original fixture bytes,
statuses, diagnostics, PDF measurements and 69 artifact hashes. A 5,069-file
source/build fingerprint was taken before an independent repeat and checked
afterward, including new-entry detection: no drift. Its digest is
`c563741b6f8134ce2a9cffffd356cd0b577f21bedca2314bc1f71eb1bf9afa31`.
The JSON defines scope and ordering. This was not an immutable committed-candidate
or whole-release gate; other workspace dependency trees were not fingerprinted.

Fresh official source was downloaded only into owned out scratch; SHA-256 matched
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The inspected archive member `src/ssconvert.c` hashed to
`0d600c72a05645e6940730bf6e733636ec25f814c20a218cb5e5255da5b198df`.
Reference-profile hash remained
`f5767a61ed1356d95600370135bf3afce808c17aabc0c633d881e14578a8347e`.

Colima was reachable in this follow-up. The reference profile's `/opt` binary
and two private libraries were absent; 78 other captured library/font hashes
matched. That reference runtime remains unavailable, not qualified by substitutes.
The separate `chart-rendering-verification.json#nativeQaProfile` qualified all
74 recorded binary/library/font hashes. Native Gnumeric 1.12.61 ran separately
in its existing `ssconvert-statistics-qa` container with `env -i`, C/UTC,
memory GSettings, its pinned library/schema paths and owned empty HOME/XDG roots.
These fresh results belong to that separate profile, whose plugin inventories
differ. Unrecorded plugin binary identities and other runtime variants were not
newly qualified. Native and PyMuPDF 1.26.5 were isolated QA capabilities only.

## Terminal inspection

Searching the current root CLI/SDK source found no ssconvert forwarding route.
No root ssconvert subcommand was invented. Consequently no applicable route used
`npm run screenshot-poe-code`; actual public built Safe Bash Shell,
MemoryFileSystem and ssconvertCommands invocations were captured using
`npx tsx scripts/screenshot.ts --no-header -o <owned-image> -- node --input-type=module -e <inline-session>`.
A separate terminal image displayed the fresh native captures. Both were
inspected with view_image; labels explicitly separated stdout/stderr and harness
annotations from command bytes. This does not measure concurrent sink ordering.

| Command                               | Exit | stdout bytes | stderr bytes | Differential result                    |
| ------------------------------------- | ---: | -----------: | -----------: | -------------------------------------- |
| `ssconvert --help`                    |    0 |         1475 |            0 | Equal after program-path normalization |
| `ssconvert --list-importers`          |    0 |            0 |         1277 | Profile mismatch                       |
| `ssconvert --list-exporters`          |    0 |            0 |         1775 | Profile mismatch                       |
| `ssconvert --visual-invalid`          |    1 |            0 |          109 | Equal after program-path normalization |
| `ssconvert /missing.xlsx /result.csv` |    1 |            0 |           43 | Exact channel/status equality          |

Option descriptions and list separators align; errors are readable, with no
ssconvert styling or spinners. The long per-sheet help description clips at the
terminal image's right edge in both current/native captures. This is a renderer
limitation, not an exact-layout pass; raw captures retain the full line.
Normalizing only the native invoked executable path gives exact help and
unknown-option channel equality. Their unnormalized bytes differ.

The current importer list adds Paradox and Psion to this separate native profile;
the exporter list adds Paradox and Gnome Glossary. Remaining lines and ordering
match. Lists use stderr in both commands, with empty stdout. These observations
do not qualify optional-plugin runtime cells or justify removing providers.

## Printed pages

Original fixtures contain one Visual sheet with `visual row 0` through
`visual row 89` in column A. Portrait uses default print information; landscape
explicitly persists `na_letter`, landscape orientation and 50 percent scale.
Fixture bytes are preserved in the measurements. Literal command invocations:

- `ssconvert -T Gnumeric_pdf:pdf_assistant /portrait.gnumeric fd://1`
- `ssconvert -T Gnumeric_pdf:pdf_assistant /landscape.gnumeric fd://1`
- `ssconvert -T Gnumeric_XmlIO:sax:0 /portrait.gnumeric /checkpoint.xml`
- `ssconvert -T Gnumeric_pdf:pdf_assistant /checkpoint.xml fd://1`

The landscape fixture also passed checkpoint/replay. All conversion/checkpoint
commands returned 0 with empty stderr; checkpoints had empty stdout. Both PDF
fixtures matched the injected SDK conversion bytes and checkpoint/replay bytes,
including the fingerprint-bound repeat. Explicit binding: codecs `[]`, C/UTC,
input 1,000,000 bytes, output 4,000,000 bytes, 10,000 cells, 10 sheets,
100,000 operations and 10,000,000 workbook work units. Each SDK operation used
an injected AbortSignal. I/O was memory byte I/O; only outer QA saved evidence.

Current and freshly captured native PDFs were rendered with the same isolated
PyMuPDF 1.26.5 at 72 DPI. All eight page images were inspected with view_image.

| Fixture                      | Current/native pages | Point geometry                        | Per-page row distribution |
| ---------------------------- | -------------------- | ------------------------------------- | ------------------------- |
| Portrait                     | 2 / 2                | 595.2755737304688 × 841.8897705078125 | 0–46, 47–89               |
| Letter landscape, 50 percent | 2 / 2                | 792 × 612                             | 0–57, 58–89               |

Geometry and extracted text tokens match per page, including centered Visual
headers and Page 1/Page 2 footers. No page-edge clipping was visible. Font fidelity
fails: current PDFs embed JetBrainsMono-Regular; native PDFs embed DejaVuSans.
Current labels are wider, with visibly different glyphs, horizontal placement and
header/footer typography. Matching pagination is not matching print appearance.

## Graphs and negative controls

The original 216×108-point absolute-anchor graph was tested both empty and with
an XY chart, title Visual QA and three points (1,1), (2,4), (3,2).
The corrected plot uses GnmGODataVector references to original worksheet cells.
Native PNG output is 300×150, with a legible title, axes/ticks, blue connecting
lines and diamond markers. That image was inspected with view_image.
The current command returns 1, empty stdout and exactly
`Unsupported ssconvert feature: graph scene rendering\n`; native returns 0 with
empty channels. Actual plotted chart export is unsupported, not a visual pass.

The empty graph succeeds with empty channels in both commands. Both inspected
PNGs are 300×150 and have identical decoded RGBA pixels. Current encoded output
is 180,228 bytes; native is 270 bytes. Pixel equality does not imply encoded-byte
compatibility. Empty-graph command/SDK bytes also match in the bound repeat.

An initial plot used GODataVectorVal dimensions. Native emitted unknown-type
warnings, so that case was excluded from plotted fidelity conclusions and
replaced with the worksheet-backed fixture. Its original capture and diagnostic
hashes remain distinguished in measurements; it is not counted as a valid plot.
Fixtures are deterministic and original; no generated seed is required.

Print-grid rejection returns 1 with
`Unsupported ssconvert feature: PDF print grid\n`. Missing-object selection returns
1 with `ssconvert: There is no object with name 'missing'\n`. Both preserved the
existing destination sentinel `untouched`. These measure current rejection and
namespace preservation, not fresh native equality for those controls.

## Gates and remaining coverage

Passed maintained checks:

- Uncached `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  18 builds including postbuild.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint and maintained source,
  test and consumer TypeScript checks.
- `npm test --workspace=@poe-code/ssconvert -- --no-cache`: 317 test files,
  6,275 tests, 53.89 seconds. No native utility was introduced into unit tests.
- Independent fingerprint-bound repeat of CLI channels/statuses, both PDFs,
  SDK/checkpoint/replay, corrected graph cases and missing-object sentinel.

No selected check failed or timed out. The original reference qualification
failed for three absent files; the separate chart-profile qualification passed.
Compatibility failures are fonts and encoded PNG bytes; profile mismatches are
lists and unnormalized invoked-path text. Plotted graph rendering and print-grid
are unsupported. The initial invalid graph was an excluded fixture defect.

Safe Bash's whole unit/typecheck suites and root npm test/lint/build were not run
for this documentation-only audit; a package pass is not a cross-workspace full
gate. Other runtime/locale/plugin variants, custom paper, repeated titles,
manual breaks, hidden rows/columns, styles/merges/wrapping, graph target codecs,
graph fonts/axes/labels in the current renderer, adversarial budgets,
cancellation cleanup, realm/host authority and remote adapters remain unverified
in this follow-up. Repeated command/XML checkpoint execution does not establish
general replay or isolation. No performance cohort was measured.

No product implementation occurred, so repair-specific TDD and post-implementation
independent stress/fix-agent gates were not activated. Scratch images, downloads,
logs and the isolated renderer environment were purged only after reduction;
the owned container scratch was also removed. Existing captures and edits were
preserved. No local commit, remote-main delivery or release occurred.
