# Selectable spreadsheet formats

Tracking: hey-boss #4091. Compatibility work remains tracked by #1748;
release integration remains tracked by #3360.

The user requested twelve hours of implementation beginning 2026-09-29
02:34:55 UTC, with compatibility work ordered by common usage: XLSX,
CSV/TSV, ODS, XLS, then the remaining formats. This ordering is an engineering
priority, not a measured market-share claim or cancellation of existing scope.

## Intended behavior

A consumer chooses the file formats it supports by composing explicit format
modules around a shared spreadsheet model and engine. A CSV/XLSX application
must not register or bundle the ODS, BIFF, Lotus or PDF codecs. An empty format
selection supports no file formats. Unsupported input or output fails before
publishing a destination. The command and SDK use the same composition.

Existing default ssconvert entrypoints retain their format set and service IDs.
Custom codec overrides retain their existing direction and metadata semantics.
Selections are owned snapshots; later mutation of caller arrays cannot expand
an engine's capabilities. There is no global mutable registry.

## Architecture

- A spreadsheet AST package owns the workbook/cell/range model, immutable
  ownership and address operations. It has no command or file-codec dependency.
- The engine owns conversion orchestration, explicit I/O, cancellation and
  diagnostics. Its registry receives format definitions from its caller.
- Format modules own their registration metadata, readers, writers and probes.
  Shared XML/ZIP, text, numeric and formula utilities stay below format modules;
  a format must not import a competing format to obtain a shared utility.
- The ssconvert command package composes the engine, selected formats and
  virtual-shell adapters. Compatibility defaults live at this composition edge.
- Public exports and packaging preserve real module boundaries. Consumer bundle
  inspection verifies exclusion of unselected codecs, not just filtered listings.

## Delivery sequence

1. Integrate the requested ODF rich-text patch. The owner delivered it as
   `42102a5893`; the implementation checkout fast-forwarded to that remote commit.
2. Add explicit provider selection and registry ownership tests; keep default
   registration behavior compatible. Split the combined Excel provider so XLSX
   can be selected without BIFF or SpreadsheetML.
3. Extract the shared AST and codec-free registry/engine boundaries. Move real
   implementation ownership rather than add forwarding-only package facades.
4. Expose independently consumable format modules and command configuration,
   starting with XLSX and CSV/TSV, then ODS and XLS. Update existing usage docs.
5. Resolve validated issues for those formats, one atomic improvement at a time.
   Preserve other workers' active fixes and reconcile incoming changes.
6. Verify maintained package checks, broader integration for workspace changes,
   installed SDK/command consumers, bundle contents and relevant CLI screenshots.
   Push atomic commits to main and monitor containing releases through publication.

## Acceptance evidence

- Failing-before/passing-after in-memory tests for format selection, disabled
  probing/export, conflicting registrations, immutable configuration and
  preservation of default behavior.
- Actual selected-format read/edit/write through SDK and command, including
  preserved destinations on refusals and exact cancellation identities.
- AST-only and selected-format bundles without unrelated codec implementations;
  strict NodeNext and browser/Worker consumers from actual package exports.
- Current remote-main commit ancestry and a separately verified registry release.
- Remaining compatibility scope stays open; test counts and registration alone
  do not establish full format fidelity.

## Implementation checkpoint

`86f8fad8fe` delivered explicit selection to remote main. `275b624b9f` delivered
the extraction, with its integration series through `f6c3539dbc`. The architecture
places the workbook model in `packages/spreadsheet-ast`, orchestration in
`packages/spreadsheet-engine`, and actual readers/writers in
`packages/spreadsheet-format-{xlsx,csv,ods,xls}`. Original command source paths
remain compatibility exports. The neutral engine has no implicit formats.
Public `/ssconvert/core` and `/ssconvert/formats/*` entries compose the chosen
implementations. The AST has a separate `/safe-bash/spreadsheet-ast` entry.

The new `adoptWorkbook` operation validates and snapshots an independently
created or edited AST under the receiving engine's budgets. It preserves the
existing requirement that writes operate on a workbook owned by that engine.

Verification completed for the initial architecture before later upstream changes:

- Seven affected package lint/type checks and 494 ssconvert test files / 26,287
  tests passed. The maintained build completed 189 tasks across 190 workspaces,
  including root bundles; repository ESLint, type checks and workflow lint passed.
- Installed root/scoped consumers passed AST→XLSX→CSV roundtrips, exact failed
  export bytes, shared error-class identity and strict browser NodeNext types.
  AST-only, CSV, CSV+XLSX, ODS and XLS browser bundles excluded unselected formats.
- Scoped package generation passed with explicit source and license entries.
  Public/workerd tests and canonical public command factory identity passed.
- Independent openpyxl, odfpy and xlwt fixtures were read by both publications;
  openpyxl, odfpy and xlrd independently read six exported workbooks. Unicode,
  multiline/quoted strings and numbers survived these basic interoperability
  checks. This does not establish complete Excel/LibreOffice fidelity.
- Selected-exporter CLI output was rendered and visually inspected. An ownership
  audit found 227 implementations identical after import normalization; remaining
  differences were reviewed against AST ownership, neutral engine composition,
  shared helpers and module boundaries.

At the 2026-09-29 08:15 UTC checkpoint, the complete shared unit phase had passed
3,346 files / 372,438 tests (2 skips and 5 TODOs recorded separately). After the
new public AST export was added to the supported-export assertion, the maintained
full rerun reused all 89 shared cache records, passed 197 root files / 4,693 tests,
and passed all 652 Safe Bash build/packaging runner tests. The remaining native
behavior tests are active; this is not a complete full-gate result.

Further delivered fixes include XLSX string formula caches (`6d478e6e83`),
ODS fractional time import (`91a8df9bed`), named-formula base IDs (`61558ed0d4`),
signed and abbreviated durations (`371deddbd9`), and fractional time export
(`9ac53e4f51`). The duration fixes have focused failing-before regressions,
existing ODF regressions and independent LibreOffice numeric interoperability
evidence. These results do not establish broader spreadsheet fidelity.

`2d3bdaef51` delivered SpreadsheetML reader, metadata and schema ownership in
`packages/spreadsheet-format-spreadsheetml`, with root/scoped selected-format
routes. `d9b17d1963` removed soffice's early Node prebundle, and `db78c3bab6`
repaired canonical XML runtime copying into scoped SafeFS. Those three commits
are verified on remote main; 228 focused boundary/packaging checks passed.
Actual installed-consumer qualification and containing publication remain open.
HTML table ownership is the next format extraction, tracked by #4294, preserving
the compatibility provider's additional LaTeX/roff registrations.

At the 2026-09-29 11:45 UTC checkpoint, both pinned releases of `9ac53e4f51`
failed before publication. The scoped run exposed the repaired soffice bundle
problem; root fresh unit and shell checks have separately tracked failures.
The frozen full unit gate at `fbd6434f79` finished with native shell failures;
it does not cover the later duration fixes and is not a passing full gate.
Newer shell compiler failures prevent a successful current containing build.
The release owner is reconciling those changes while focused format work proceeds.

At the 2026-09-29 12:05 UTC checkpoint, complete maintained build and lint passed
with the incoming compiler repairs. Fresh root/scoped artifacts include HTML
reader/writer ownership in `packages/spreadsheet-format-html`, the SpreadsheetML
declaration correction, the portable soffice build, and canonical XML copying.
Installed SpreadsheetML and all five HTML writer profiles pass actual workerd
checks; selected bundles exclude competing codecs. Strict NodeNext public types
pass. Independent HTML parsing verifies Unicode, entities and numeric cells in
all ten HTML outputs. HTML fixtures declare UTF-8, and readback accounts for the
existing document-title sheets.

Installed root/scoped soffice passes ODS-to-CSV/XLSX conversion and destination
preservation on input-budget rejection in Node and workerd without
`nodejs_compat`. The aggregate command runtime retains its existing JavaScript
Buffer shim; `process` remains unavailable. Public XML limit-error constructor
identity passes. Independent openpyxl/CSV readback preserves Unicode, multiline
text, numbers, booleans and the second-sheet AB1 cell. After rebase onto the
delivered SafeJS parser repair, 197 focused/compatibility tests and full lint
pass. HTML and declaration commits still await remote delivery at this checkpoint;
no containing publication has been verified.

The HTML and SpreadsheetML declaration commits were subsequently verified on
remote main as `9b82e17b71` and `4b8bbac088`. Scoped run `36565974052` and root
run `36565977028` explicitly pin that containing revision; publication remains
pending. A later lint pass found an incoming dd empty-catch diagnostic, tracked
with the release owner separately from format work.

DBF is the next selected table importer, tracked by #4295. Its real reader lives
in `packages/spreadsheet-format-dbf`; database encoding and record helpers shared
with Paradox, DIF, SYLK and other legacy readers move to the neutral engine.
The existing `Gnumeric_xbase:xbase` service remains import-only. Four source
moves are identical after import normalization. The missing selected route was
captured before implementation; 32 focused and 154 shared regressions pass,
along with package lint and the maintained selected build. An independent
Python dbf 0.99.11 fixture agrees with both the compiled reader and native
Gnumeric 1.12.61 on code-page text, numbers, booleans and deleted-record skipping.
LibreOffice DBF export attempts failed and are not counted as qualification.
The complete containing build, full lint and all 18 package rules subsequently
passed. Fresh root/scoped tarballs include the DBF runtime route, declarations,
license and shared helper declarations. Isolated installed workerd consumers
match the independent records without Node globals or competing formats, and
strict public NodeNext types pass. Delivery and publication remain pending for
this DBF checkpoint.
