# PDF export options continuation QA

Status: implemented and verified additional PDF behavior; **full Gnumeric PDF
compatibility remains incomplete**. This extends the inherited partial exporter,
not an assertion that the original task is complete. Earlier evidence and
limitations remain in [the original QA record](ssconvert-pdf-export-options-qa.md).
Independent review is recorded in [clipping and print stress QA](ssconvert-pdf-clipping-stress-qa.md).

## Manual procedure executed

1. Authenticate the existing official archive in
   `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` with SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Read primary source only from its extraction under `out`. Inspect
   `print-info.c`, `print.c`, `gutils.c`, `sheet.c`, `xml-sax-read.c` and
   `xml-sax-write.c`. Inspect the public `@poe-code/pdf` serializer, font and
   raster decoder exports; preserve those inherited implementation edits.
2. Before implementing additional behavior, run new original in-memory
   regressions: a tall workbook graph spanning two pages, landscape Letter
   at 50 percent scale, and changed top/bottom margins. Observe rejection
   failures in the existing exporter. Unit fixtures never use native utilities,
   LLMs or host file writes. Safe Bash namespace tests use memfs.
3. Execute the explicitly separate native oracle in Docker context `colima`,
   container `ssconvert-statistics-qa`, prefix
   `/out/ssconvert-statistics-oracle/prefix`. Use C locale, UTC, explicit
   library/schema/data paths and memory GSettings backend. Capture native
   version, installed dependency versions, font resolution and 47 plugin
   descriptor hashes in owned scratch `out/ssconvert-pdf-continuation`.
   Native version command succeeds and reports 1.12.61; Sans resolves to
   DejaVu Sans Book. This is one profile, not a matrix of all installations.
4. Run native and final-candidate product exports on original small fixtures.
   Compare rendered page geometry, per-page extracted text and exact red-region
   masks. Inspect raster screenshots and actual virtual-command diagnostics.
   Use maintained `npm run screenshot -- --output out/.../cli.png --no-header
   node --import tsx out/.../cli.ts` to capture the actual Safe Bash diagnostic;
   the root poe-code CLI has no changed visual flow.
5. Use a different agent to stress the implemented tool. Validate every
   proposed fix with a failing case and inspect the entire upstream consumer
   path before changing behavior. Root owns exports, integration and Git.
6. Freeze the product candidate; run maintained package test/lint and selected
   build closures uncached, plus actual command/SDK/XML-checkpoint/replay
   integration and final independent stress. Re-run native comparisons on
   that exact candidate. Record failures and unavailable cells separately.

## Implemented behavior and verified differentials

- Workbook objects now use the native 2-point column margin plus half-point
  leading-gridline offset and page-range clipping. Supported cell-anchored
  graphs/images can continue across pages. Absolute spanning objects remain
  explicitly unsupported.
- Tall graph: original one-cell anchor A1:C55, 100 by 700 points, opaque red.
  Native status 0; native/product two A4 pages. Drawing origins are
  `(74.5,120.5)` and `(74.5,-478.75)` in top-origin coordinates. Rendered red
  masks match exactly on each page at 72 dpi, with hashes
  `ac93b3ff41648e4f75f6cd90e8cd239770c4043443f9ef566e44b2c83ab5b7a0`
  and `c6fb2e39f7a4eded7944b0cf5d6dda28d1accb6b8a5e0c7dca64d55e5148c514`.
  This certifies those regions, not full-page pixels or other charts.
- Retained print settings now feed the existing pagination engine: named
  paper, portrait/landscape orientation, margins, percentage/fit scaling,
  centering, page order, header/footer formats and `do_not_print`. Foreign
  namespace nodes/attributes cannot override native print settings.
- Landscape Letter at 50 percent, 90 original row labels: native status 0;
  native/product two 792-by-612-point pages, rows 0–57 then 58–89. No row text
  lost. Scaling applies to body geometry/text/objects, not header/footer paint.
- A4 with top/bottom margins 200 points, same 90 labels: native status 0;
  native/product three pages, rows 0–33, 34–67, 68–89.
- Workbook-wide `&[PAGES]` uses precomputed page totals, preserving header
  paint before body paint and cumulative page numbering across sheets.
- Independently reproduced repairs: explicit named paper overrides retained
  unknown paper; explicit CLI/SDK sheet selection overrides `do_not_print`;
  selected hidden sheets remain excluded. These follow `pdf_write_workbook`
  and the `GNM_PRINT_ALL_SHEETS` consumer, not guessed selection semantics.
- Independent negative/edge controls cover four Cartesian pages, fractional
  anchors, exact boundaries, touching objects, balanced painter states,
  arbitrary cancellation-reason identity, pre-abort, later-sheet work limits
  before painting, unknown/foreign attributes, fit and percentage transforms,
  asymmetric headers, suppression by margins, both page orders, empty explicit
  SDK selection and unsupported print controls. No performance bound is inferred
  from these deterministic semantic cases.
- Native repeated-object behavior remains first-collected-object output, as
  already verified in the original QA record. The new implementation preserves
  option collection and object-over-sheet precedence.
- Actual Safe Bash and SDK stream outputs are byte-identical; original input,
  Gnumeric XML checkpoint and replay yield identical PDFs for the persisted
  landscape fixture. Unsupported grid exits 1 with exact product diagnostic
  `Unsupported ssconvert feature: PDF print grid\n`; an existing destination
  remains unchanged. This diagnostic is explicit unsupported behavior, not
  a native-compatibility pass.

## Metadata audit and remaining mismatches

No PDF field or page content was normalized in comparisons. Native producer
remains `cairo 1.18.4 (https://cairographics.org)` versus product
`ssconvert JavaScript PDF writer`: this deterministic metadata mismatch remains.
Native creation dates are present and were already proven invocation-dependent
in the original audit; product omits them. No other deterministic metadata field
is treated as nondeterministic. Full raw PDF byte equality is not established.

The original limitations table remains applicable except for the specific
print geometry and cell-anchored page-crossing support above. In particular:

| Area | Unsupported or unverified |
| --- | --- |
| Cell/text paint | Native DejaVu Sans versus supplied JetBrains Mono; native/product font sizes, inset, baselines and glyph geometry still differ. Styled/merged/rich-text cells, native alignment/overflow, formula-display paint, conditional styles and complex shaping remain unsupported/unqualified. Full workbook pixels differ despite matching measured row boundaries/content. |
| Print settings | Enabled grid/headings, style-only printing, monochrome/draft, repeat titles, persisted page breaks and nondefault comment/error policies fail explicitly. Print areas/names, copies, display formulas and full malformed-settings/native fallback semantics remain unqualified. |
| Charts/objects | Populated charts, shapes, controls, comments and components remain unsupported. Only admitted root graph backgrounds and raster scenes are painted. Absolute spanning, mirrored/negative placement and cell-relative hidden-axis placement remain unsupported; native object anchor-bound/geometry disagreement, transformations and zero/clamped graph sizes remain unmeasured. |
| Paper/warnings | GTK full paper catalog/custom sizes and unknown-paper warning/success fallback remain unqualified; unknown export paper still returns explicit unsupported status 1 rather than native warning and status 0. |
| Raster/fonts | Broader PNG formats/interlace/depth and JPEG/ICC/CMYK diagnostic/pixel matrix remain unmeasured. Existing embedded raster/font unit controls are not new native-matrix passes. |
| Empty/hidden storage | Empty/style-only/blank-only workbooks, hidden-axis extents and complete upstream print-area storage semantics remain unqualified. Source uses `sheet_get_extent(...,TRUE,FALSE)` with ignored empty cells; product still uses its workbook extent projection. |
| Runtime/boundaries | One Node 22.22.2 host cell verified. No new native/ambient file/network path introduced. Foreign XML namespace admission is tested; hostile-JavaScript realm admission, standalone packed consumers, alternate hosts/architectures/locales/dependency variants and new authority/rollback guarantees remain unverified. XML checkpoint/replay is verified, not arbitrary shell checkpoint restoration. |
| Budgets | Preplanning, pre-abort, scanline and final-output admissions have deterministic controls. Peak font/JPEG/parser memory, CPU/RSS guarantees and asynchronous cancellation while synchronous layout is running remain unmeasured. |

## Gates and failures

Final product checks:

- `npm test --workspace=@poe-code/ssconvert -- --no-cache --maxWorkers=1`:
  **272 files, 5,707 tests passed**, zero reported failures/skips.
- Focused final PDF suite: **five files, 56 tests passed**.
- Different-agent final stress: **27 cases passed**, no skips/failures;
  included in the final focused suite, not additional unique test counts.
- `npm run lint --workspace=@poe-code/ssconvert`: passed ESLint and product/test
  TypeScript checks; independent agent reran and passed the same maintained route.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  passed final maintained dependency closure and native npm postbuild stages.
  Membership came from repository declarations; observed receipt reports 18
  builds. Earlier selected ssconvert closure passed as well.
- Actual Safe Bash PDF command/SDK/checkpoint/replay integration: **two tests
  passed**, zero reported failures/skips. Changed integration-file ESLint passed.
- Native measured scenarios and manual CLI/rendered-page screenshot inspection
  passed the stated content/geometry/region checks; typography/metadata failures
  remain recorded above. Git diff whitespace check passed.

Failed earlier runs, investigated separately:

- Tall graph and two retained-geometry regressions failed before implementation.
- Initial geometry assertion incorrectly expected a rectangle operator;
  pdf-lib emits translated polygon paint. Corrected the test encoding assumption
  while retaining independently measured coordinates and clipping assertions.
- Independent proposed centering value=2 repair was retracted: the XML reader
  retains integers, but `print_page` explicitly compares centering to 1.
  Negative controls now assert value 2 behaves like disabled value 0.
- First full package gate: **270 files passed, two files failed; 5,700 tests
  passed, two failed**. One loaded the intermediate retained-paper rejection;
  the other timed out at 5 seconds in `R.QTUKEY(-1000,3,10,1,TRUE,TRUE)` while
  several worktrees/builds were busy. The entire maintained package gate was
  rerun, not replaced by a focused rerun. The same distribution case passed in
  the full one-worker rerun (about 1.89 seconds); no timeout increase or unrelated
  statistics-code change was made. Contention is suspected, not measured proof
  of a universal performance guarantee.
- Initial CLI integration ran before the updated build completed and loaded the
  previous compiled writer; failed persisted-settings case. Both integration
  cases subsequently passed after the final maintained build closure.
- Initial lint found a TypeScript narrowing error in the new print reader;
  corrected explicit never-return flow, and final complete lint passes.
- A manual oracle profile helper initially omitted library paths and obtained
  no valid version identity. Recapture with explicit paths returned status 0 and
  version 1.12.61; the initial profile is not a passing oracle cell.

Skipped/unexecuted: full repository `npm test`, repository-wide lint/build,
full Safe Bash suite, E2E, optional runtime/dependency/locale matrix and packed
consumer gates. Changes are confined to ssconvert's PDF/print implementation
and focused Safe Bash integration tests; shared PDF/root exports were preserved.
No workflow changes, workflow unit tests or release gates were run. No gate is
left running at delivery. Unsupported/unavailable cells above are not passes.

## Frozen identities and delivery

These are SHA-256 source identities, not Git commits:

- `packages/ssconvert/src/codecs/pdf.ts`:
  `dee8d3edef0d2ac5e25e07965c946508f8604df0fa6e0b811b082877de4bdc86`
- `packages/ssconvert/src/rendering/print/settings.ts`:
  `0e0bc671e2c1eec09a90591588285e4b1ffe67af3bcb9f96b696f9f5d7c7bf6d`
- `packages/ssconvert/src/codecs/pdf-print-settings.test.ts`:
  `978ffde3fbd7cc6f91e1422ae4fabca0c7bec42dd4cbf5b2effcaa04f91d0316`
- `packages/ssconvert/src/codecs/pdf-independent.test.ts`:
  `1874581059c0fcbc6ac11da2b49658cdd8c7eda3f4fedd8509906630cd81c519`
- `packages/safe-bash/tests/commands/ssconvert-pdf.test.ts`:
  `04b851f28df2f913e06ba8199e5fc67e088f82a0665209ff848e9d534cbbad1d`

Root retained export/integration/Git ownership. No README changes. No local
commits, no remote-main delivery, no push/publication or successful release.
Inherited edits and evidence/dependency environments remain untouched.
Owned temporary logs, generated export fixtures/drivers, PDFs and screenshots
were purged after inspection and recording these results. The required captured
reference dependency/plugin/locale profile remains under
`out/ssconvert-pdf-continuation/profile.json`; reproducible minimized scenes
remain in the unit fixtures. Earlier inherited captures were not removed.
