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

At the 2026-09-29 13:20 UTC checkpoint, fresh artifacts at `06167ce1e7`
pass the complete scoped installed-package release gate: optional dependencies,
Node and Bun behavior, public declarations, isolated browser/Worker realms,
browser command behavior and factory identity, legacy coexistence, filesystem-only
consumers, and 15 native Cloudflare files / 87 tests. The local macOS harness uses
explicit canonical temporary directories; its assertions are unchanged.

The gate exposed three repaired publication prerequisites: the unrtf adapter's
plugin name, an LLM type fixture that widened supplied providers to optional,
and browser wildcard exports lost while canonical private owners remained
external. The latter repair preserves all 440 existing portable runtime exports
and all 24 public browser entrypoint surfaces, retaining the same command factory
across root and subpath imports. Its failing-before regressions, all 222 packaging
tests and full maintained lint pass. This is artifact qualification, not registry
publication.

The earlier `b92f4b02af` complete build also produced fresh root/scoped selected
DBF, HTML and SpreadsheetML Worker consumers and public type checks. Independent
Python/Gnumeric records agree with DBF import; ten HTML outputs independently
parse correctly. Installed soffice Worker exports retain the expected Unicode,
multiline, numeric, boolean and second-sheet values under CSV/openpyxl readback.

Reconciliation preserves the upstream CSV schema, tar extraction and shared
callback repairs in `41b6c009cd`, `855ae69c41` and `e877a3bf20`; this session's
remaining CSV/tar commits retain additional regression coverage. The redundant
callback commit is dropped. A current maintained Safe Bash build is refreshing
compiled outputs after the latest incoming command changes. DBF and the remaining
publication fixes still await push at this checkpoint; no containing published
release is claimed, and the broader compatibility families remain open.

The eight pending commits were subsequently verified on remote main
`0a4e96adff`: DBF ownership, the unrtf adapter name, CSV/tar regression coverage,
the LLM declaration fixture, canonical browser exports, qualification notes and
additional op completion regressions. The containing maintained build and full
lint passed, along with 236 focused and 101 conversion checks. Equivalent op
and evaluator runtime repairs delivered by other workers were preserved.
Scoped pin `36576991455` selects that exact revision; root pin `36577000641`
selects its descendant `cdf3bdb837`. Publication remains separately monitored.

Follow-up #4308 reconciles the newer synchronous conversion path with the same
ownership boundaries. The shell adapter now only wires archive operations and
the evaluator; command parsing and dispatch live in the command owner. CSV
parsing/formatting lives in the CSV format package, with the field quoting
function shared by synchronous and canonical exporters. XLSX package-entry
parsing/writing lives in `xlsx-ast` and uses the shared XML parser and spreadsheet
cell-value types. ZIP operations remain an explicitly supplied composition
dependency; selected format bundles contain no shell command or PDF renderer.

This is a dense, unformatted synchronous profile, with canonical fallback for
unsupported workbooks before destination publication. It retains the incoming
sparse-coordinate fallback. Failing-before cases cover escaped string literals,
rich string runs, booleans, XML namespaces/quoting, CSV whitespace and sheet-name
preservation. Typed XLSX values survive canonical writer readback; an independent
openpyxl input and openpyxl/CSV output readback preserve its sheet name, Unicode,
whitespace, numbers, booleans and the string `007`. Existing XLSX/text regressions
passed 628 checks before the final sheet-name correction; subsequent focused
checks and the maintained containing build/full lint pass. This follow-up still
awaits delivery at this checkpoint and does not establish full XLSX fidelity.

## Verified publication and remaining scope

At the 2026-09-29 15:03 UTC checkpoint, the twelve-hour implementation period
has ended and release verification continues. All ssconvert implementation work
through `9b6eec47edade0839282703a8cda358c8f97e503` is verified on remote main.
The pending ODF rich-text work and independently selectable XLSX, CSV/TSV, ODS,
XLS, SpreadsheetML, HTML and DBF owners are included. SpreadsheetML and DBF remain
import-only; compatibility defaults retain their existing registrations.

Scoped `0.1.754` publishes the architecture checkpoint `0a4e96adff`.
Scoped `0.1.755` additionally publishes the final synchronous codec-owner fix
`9b6eec47ed`. Both releases passed independent exact-version checks of all three
public archives, SHA-512 integrity, matching source provenance, fresh npm
resolution/installation, Cloudflare artifact contracts and Node imports.
The initial Safe Bash registry 404 responses subsequently resolved without
republishing or weakening verification. Final scoped run
[36580487751](https://github.com/poe-platform/poe-code/actions/runs/36580487751)
completed both publication and verification successfully.

For that final source, the maintained containing build and full lint passed,
along with 51 final focused checks and 123 shell checks. Installed spreadsheet
conversions passed in Node, Bun and actual workerd without `nodejs_compat`;
independent openpyxl input/output readback verified sheet names and typed values.
The hosted complete installed-package gate passed all 15 native Cloudflare files
and 87 tests. These are scoped artifact and conversion results, not full format
fidelity or successful root-package publication.

The separate root `poe-code` release remains unverified. Pin `36580494936` at
`9b6eec47ed` was cancelled after its Pandoc failure was independently reproduced.
Replacement pin
[36585960531](https://github.com/poe-platform/poe-code/actions/runs/36585960531)
selects `e0a0878513`, whose ancestry includes both the final ssconvert changes
and Pandoc repair `683adeb82b`. It is pending at this checkpoint; root runtime
and declaration ownership repairs remain tracked by #3360. Cancelled and
superseded runs are not publication evidence.

The local complete installed gate had 84 native passes and three 30-second
deadlines. Exact retries passed both storage cases but reproduced the session
capacity deadline; diagnostic worker startup alone took 26.562 seconds. Its
cause remains open in #4314, separately from the unchanged hosted gate's pass.

The validated XLSX formula-cache fixes in #3521 are published. Its supplemental
formula/defined-name text-encoding question remains open: recorded Gnumeric,
openpyxl and Calc roundtrip observations do not justify unconditional Xstring
decoding. Broader compatibility families under #1748 also remain open. Completed
format-extraction and release-prerequisite issues have individual acceptance
audits; no blanket compatibility closure or full-fidelity claim is made.


## Selected-format command composition audit

The post-publication audit found that selected SDK bundles were isolated, but
`createSsconvertCommand({ formats: [csvFormat] })` still statically imported the
compatibility engine. The reproduced browser bundle included 262 unrelated
codec/rendering inputs and occupied 10,853,309 bytes. Issue #4417 tracks this
remaining command-side architecture requirement; scoped 0.1.755 does not fix it.

The new `/ssconvert/commands` entrypoint binds the shared shell adapter to the
neutral engine, with explicit format and rendering capabilities. `/ssconvert/core`
remains the engine-only entrypoint. Existing `/ssconvert` and shell command
imports retain their built-in defaults and synchronous executor eligibility;
composable commands do not enter that default-only fast path. Both root and
scoped publication routes expose the same command factories and option type.

Source bundle regressions cover CSV-only and CSV+XLSX selections and retain the
SDK-only isolation assertions. Command checks cover disabled-format destination
preservation, snapshots, duplicate registration and empty/default registrations.
Published-bundle checks exercise raw arguments, output budgets and cancellation
through the selected entrypoint. The installed-package release fixtures now
exercise selected CSV conversion, disabled XLSX preservation, empty defaults,
plugin registration and the public TypeScript contract. The command fix is
verified on remote main as `e765e7c23d`. Its full package suite passed 26,511
checks across 500 files; 96 shell checks, the focused bundle checks, full build
and full lint also passed. A fresh root archive passed Node, Bun, strict public
TypeScript checks, and actual Workerd CSV/CSV+XLSX conversion without Node
compatibility or unselected codec contributions. Publication remains pending.

Fresh scoped staging exposed a release prerequisite from the root runtime
ownership change: the packager rejected `dist/shared/safe-js/index.js` because
it expected a workspace output. The same failure occurred in hosted run
`36591191083`. Issue #4422 maps only declared root-owned SafeJS runtime entries
back to the scoped workspace outputs, preserving export conditions and refusing
unknown paths. Failing-before memfs coverage, all 212 packaging tests, ESLint,
and real staging of all three scoped packages pass. Fresh archives pass selected
command execution in Node and Bun, strict root/scoped TypeScript consumers, and
CSV-only and CSV+XLSX conversion in Workerd without Node compatibility. Both
scoped SafeJS entrypoints execute bounded programs in Node and Bun. Containing
publication remains pending.
