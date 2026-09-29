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

`86f8fad8fe` delivered explicit selection to remote main. The pending extraction
places the workbook model in `packages/spreadsheet-ast`, orchestration in
`packages/spreadsheet-engine`, and actual readers/writers in
`packages/spreadsheet-format-{xlsx,csv,ods,xls}`. Original command source paths
remain compatibility exports. The neutral engine has no implicit formats.
Public `/ssconvert/core` and `/ssconvert/formats/*` entries compose the chosen
implementations. The AST has a separate `/safe-bash/spreadsheet-ast` entry.

The new `adoptWorkbook` operation validates and snapshots an independently
created or edited AST under the receiving engine's budgets. It preserves the
existing requirement that writes operate on a workbook owned by that engine.

Verification completed before the latest upstream reconciliation:

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

Current upstream shell changes required further compiler reconciliation. The
latest complete build and lint evidence above predates those changes. Current
repository types and workflow lint pass; current ESLint reported unnecessary
shell-test dollar escapes to the active release owner. No extraction or canonical
factory prerequisite commit has yet been pushed, and containing publication is
not verified. The earlier explicit-selection commit `86f8fad8fe` and portable-gh
repair `2546814fc2` are separately verified on remote main.
