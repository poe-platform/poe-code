# Excel 2003 SpreadsheetML verification

The TypeScript ESM `ssconvert` engine installs the read-only
`Gnumeric_Excel:excel_xml` service. The SDK and safe-bash virtual command share
that engine, injected byte I/O and cancellation. No native executable is a
product dependency or fallback; no SpreadsheetML exporter was added.

## Reference and evidence

Reference: released Gnumeric 1.12.61, official archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
The archive and extracted primary source remain exclusively under
`out/ssconvert-lifecycle`. Implementation was checked against
`plugins/excel/excel-xml-read.c`, its declarative node table, and
`src/parse-util.c` for formula sheet quotation. Searching the archive's
samples/test files found no SpreadsheetML fixture corpus; the tests and
differentials use original small fixtures. This is not a corpus parity claim.

[Reference profile](spreadsheetml-reference-profile.json) captures binary/image
hashes, linked libraries, package versions, locales, environment, registry
listings and 38 plugin manifest hashes. Only Excel reader activation was
observed; other plugin activations are unmeasured. The oracle ran in a separate
Debian ARM64 container with LC_ALL=C, LANG=C, TZ=UTC, GOffice 0.10.61,
GLib 2.84.4 and libgsf 1.14.53. It has no role in product execution.

[Reference captures](spreadsheetml-reference-captures.json) retain original
input bytes, argv, status and diagnostic streams.
[Final verification](spreadsheetml-verification.json) retains comparisons and
every final measured mismatch. QA procedures are in
[root QA](../plans/ssconvert-spreadsheetml-qa.md) and
[independent stress QA](../plans/ssconvert-spreadsheetml-stress-qa.md).

## Verified coverage

- Root namespace/content detection distinguishes SpreadsheetML from native
  Gnumeric XML independently of `.xml` extension. Alternate namespace input
  requires forced import, matching the measured native text fallback.
- Worksheet ordering, duplicate sheets/cells, sparse Index/Span behavior,
  strings, decimal-prefix numbers, nonfinite numeric errors, Boolean fallback,
  custom errors, ordinary dates and repeated Data events.
- Default-derived styles, ignored Parent, absence of global Default application,
  fonts, fills, alignment, colors, borders, inherited borders, number formats,
  empty styled cells, retained row/column/merge style rectangles.
- R1C1 expression parsing, final sparse formula origin, individually quoted
  sheet qualifiers, cached typed values and pending-formula consumption.
  Names are processed in source order; unknown-sheet references warn/drop.
- Conditional merges, intersecting-merge failure, finite axis dimensions and
  visibility, pane selections, supported unconditioned filters and document
  properties. Print/workbook nodes with native no-op handlers are ignored.
  Links are ignored; comments warn/drop; supported rich text is flattened.
- Malformed XML fails with status 1 and deterministic damaged-document/error
  bodies. Budget admission and cancellation checks cover input, XML nodes/text,
  cells, sheets, axes, coordinates and semantic work.
- Memfs SDK/virtual-command comparisons verify identical conversion bytes,
  namespace/file preservation, replay/recalculation, forced reader/listings,
  and no output publication after malformed input.

Manual oracle QA measured 61 invocations over 40 original fixtures: **61/61
exit statuses match**, and **53/54 successful semantic comparisons match**.
The semantic projection includes sheet order/names, nonblank scalars, formulas
(including native formula cells with blank exported values), merges, explicit
axis dimensions/visibility, user names and explicit properties. Separately,
**26/26 resolved styled-cell records match**, after canonicalizing XML
attribute/child ordering and removing prefix spelling. This does not measure
all empty style rectangles or arbitrary overlapping regions.

The initial scratch comparison incorrectly omitted formula cells with blank
native values and treated absent hidden flags differently from false. The final
comparison corrects both. Native-generated Print_Area/Sheet_Title names and
creation timestamps are explicitly excluded from the importer projection;
their absence from product output remains an output mismatch, not a pass.
Native Gnumeric export omits formula caches, so cache handling is source/unit
verified rather than a cache differential pass.

## Earlier candidate checks

- `npm test --workspace=@poe-code/ssconvert`: 167 files, 4,407 tests pass.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint and both TypeScript
  projects pass.
- Maintained uncached workspace builds for `@poe-code/ssconvert` and
  `@poe-platform/safe-bash`, including their declared dependency closures.
- Scoped safe-bash ssconvert, BIFF, text and encoding command files: 54 tests
  pass. Safe-bash maintained `test:runner`: 558 tests pass. Scoped integration
  ESLint passes; root guarded ESLint also passed with four unrelated warnings.
- Ad hoc screenshot inspected importer listing, successful conversion/CSV
  display and malformed-input diagnostics through the actual virtual command.
  The screenshot adapter initially omitted standard commands; registering the
  public standardCommands plugin corrected its missing `cat` display.

One full run during concurrent builds timed out an existing extreme R.QTUKEY
case. Focused repeats (1,747/1,765 ms), its full 52-test file (1,727 ms for that
case), and the final full package run pass unchanged. No timeout increase,
assertion relaxation or speculative statistics repair was made.

## Remaining mismatches and unmeasured cases

- **Measured:** Width=INF is retained by native as `Unit=inf`; the finite
  workbook model drops it. The native XML reader used for comparison represents
  that infinity as zero, so the JSON difference alone understates the native
  source value. Width=NaN produces no explicit size in both measured outputs.
- **Measured:** native runtime PID/timestamp prefixes, invalid-date GLib
  critical logs, and duplicate-namespace GLib logs are not reproduced exactly.
  Product diagnostics retain selected deterministic bodies and tested event
  ordering, not byte-for-byte equivalence for all diagnostic streams.
- Native-generated Print_Area/Sheet_Title and default creation timestamps are
  not synthesized in product Gnumeric output. Global neutral/default exporter
  metadata is not a verified byte-equivalence surface.
- Arbitrary style/axis attribute diagnostic order remains grouped. Cell/Data
  event and Cell attribute ordering have dedicated regressions.
- Native C-long/C-int overflow attributes, signed/0x color sscanf variants,
  invalid border enums, exotic Boolean text/date inference, NaN payloads,
  dates outside ordinary Gregorian years and exotic encodings are unmeasured.
- Metadata ranges reject trailing junk accepted by native partial-prefix
  parsing. Multiple panes, late cursor attributes, cursor integer lexical
  edge cases, quoted comma selections and duplicate metadata are not fully
  measured. Conditioned filters and other unsupported nodes are not passes.
- Duplicate-name replacement/invalid names, namespace rebinding/pathological
  aliases, internal DTD/entity behavior, arbitrary 3D/external formulas and
  alternate dependency/plugin/locale profiles are unmeasured or parser-limited.
  External host resource/entity resolution remains prohibited.
- Cross-region style overwrites, cells inside earlier styled merges and XLSX
  export of all retained rectangles require further measurement. Ordinary
  finite axes, empty rectangles and custom-error Gnumeric replay have verified
  regressions, but this is not all-format round-trip parity.
- Large post-parse cancellation responsiveness and exhaustive semantic-work
  accounting are unmeasured; XML node/text budgets and repeated Data work
  admission are enforced and tested.

Existing edits were preserved. No README was edited, no Git commit was made,
and nothing was pushed or published.

## Current candidate verification, 2026-09-20

The existing implementation was preserved and independently stress tested by
a different agent. A new failing original in-memory regression established
that interleaved Table elements used the wrong column cursor and reversed
warning order. The repair processes recognized rows/columns in source order,
matching `xl_xml_table_start`, `xl_xml_col_start`, `xl_xml_row_start` and cell
advance in the authenticated upstream source. Three further independent controls
cover sparse/merge cursors, unknown-element ordering and foreign namespaces.
The prior interleaved Table processing mismatch is resolved; arbitrary overlapping
style regions and arbitrary attribute warning order remain unverified.

Current completed checks:

- `npm test --workspace=@poe-code/ssconvert`: 168 files, 4,411 tests pass,
  including 49 importer cases. This route executes tests afresh without a task
  cache. No test failures or timeouts occurred in this run.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint and both TypeScript
  projects pass. Scoped command adapter/integration ESLint also passes.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  18 builds in the maintained declared dependency closure pass, including the
  ssconvert package and safe-bash postbuild. These are selected workspace checks,
  not a completed repository-wide build/test/lint gate.
- All four ssconvert virtual-command test files pass: 55 tests, zero failures,
  cancellations, skips or todos. The new negative authority case rejects external
  entity input, reads only the supplied workbook, preserves an existing output
  and leaves the entire memfs namespace unchanged.
- Manual QA replayed all 61 authenticated captured inputs/argv through the
  built public SDK command engine with memfs byte I/O. All recorded native exit
  statuses match. Fresh native execution is unavailable: Docker cannot connect
  to `/var/run/docker.sock`. This is status-only capture replay, not a new
  native semantic/style/diagnostic differential pass. The earlier comparisons
  above remain historical evidence and are not recounted as current passes.
- Manual public virtual-command QA and an inspected readable CLI screenshot
  cover importer listing, sparse R1C1 import, native XML checkpoint and CSV
  recalculation (`4,6` at B2:C2), malformed forced import status 1 and successful
  unchanged-checkpoint replay afterward. The screenshot uses the maintained
  renderer with no adapter-code header, since the root CLI has no ssconvert
  subcommand. Temporary images/logs were removed after inspection.

Exact uncommitted candidate: base HEAD
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`; importer SHA-256
`5a18ae1ab4d141abc5fb15c90166e8c0cf28b0b0b3a68fcfdb84d9485d1852ab`;
independent test SHA-256
`0d571f406c9a38b26af3d88ad1874073982d8f6a7e565ff8b2453b8684f60def`;
command integration test SHA-256
`292cd08accce29486d59d7db66c300f2e5434de4b776b85b7d3987ab8234343b`;
built importer SHA-256
`784ebeea2bf4fc77bb5fd3463a126363d0f4bcc49d794853703c674adc2ba58b`.
The source archive checksum was reverified against the requested value.

No new oracle matrix cells, alternate profiles, exhaustive corpus coverage,
large-workbook performance/cancellation measurements, realm-isolation guarantees
or all-format style replay parity are claimed. Unsupported comments/links and
no-op print handlers retain the documented native behavior; external resource
resolution stays prohibited. All other mismatches/unmeasured cases listed above
remain open. No README, export or package manifest changed in this turn; no
commit, push or publication was performed. Current manual procedure:
[QA](../plans/ssconvert-spreadsheetml-current-qa.md).
