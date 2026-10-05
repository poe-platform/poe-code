---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# Resolve remaining ssconvert gaps

All 19 compatibility and qualification families remain open.
This compact current plan replaces the removed historical gap plan. Detailed
current findings and source receipts belong in [the case ledger](../ssconvert/gap-resolution.json).
A delivered partial fix does not close its family. The current completion audit confirms all 19 families still have unmet acceptance gates; partial main delivery is not whole-task completion. The root registry publication gap is separate from actionable implementation/qualification work and does not require waiting before further main delivery. Each case now carries a
`checkpoint20261004` separating qualified work, existing evidence, the next
acceptance test, the family closure gate and qualification blockers. Use that
checkpoint before expanding a cohort; historical receipts are not current registry
or universal profile qualification. Each family now has a finite `remainingAcceptance`
list; completed cohorts remain evidence, not new work. Native limitations stay
separate from product passes. The next PERL_DATE gate requires a containing root publication with explicit profile selection.
The zero-argument/rejected-argument C/C.UTF-8 checkpoint is complete. Retain completed Paradox version and
companion-absence controls; actual external companion content remains open.

## 1. What we're building

Resolve all reported ssconvert gaps: encrypted formats, legacy BIFF formulas,
Lotus named ranges, optional functions/services, Unicode PY_CAPWORDS, numerical
mismatches, PWD diagnostics, format preservation, rendering, solver accuracy and
optional/public artifact qualification. Preserve deliberate host-authority,
resource, cancellation and cleanup contracts. Commit improvements periodically,
deliver to remote main and verify publication. Keep the repository small.

## 2. User-facing shape

The SDK and `runCommand` must expose the same conversion, editing, recalculation,
solver and diagnostic behavior. Built-in portable code implements the requested
semantics; native applications are independent QA references. Optional services
remain explicit host capabilities. Passwords, databases, external links and FIFO
watchers never acquire authority from ambient configuration or guest arguments.

Support text must distinguish implemented behavior, verified profiles, deliberate
loss warnings and unresolved requirements. Preserve original formula/name/label
identity through copies, moves, edits and applicable transports; a cache, generated
name or fabricated function cannot stand in for an unsupported live reference.
No claim of full support from registrations, test counts or release success alone.

## 3. Implementation details and technical decisions

Source investigation comes first. The package, pinned sources and compact receipts
are available in this checkout. Native application and optional service availability
must be verified from the exact retained profile before each qualification run.
Provision missing authenticated environments through the existing host/container
routes documented in the reference procedures. Record unavailable dependencies
as blockers, never as passes, and continue independent work.

Implementation owners: `packages/spreadsheet-ast/src` holds the shared workbook
model; `packages/spreadsheet-engine/src` holds formulas, orchestration and shared
utilities; `packages/xlsx-ast/src` owns XLSX parsing/writing and the XLSX format
package supplies compatible registration/reexports. The CSV/ODS/XLS codecs remain
in `packages/spreadsheet-format-{csv,ods,xls}/src`.
The remaining codecs, rendering and command composition still live in
`packages/safe-bash-command-ssconvert/src`. Old paths for extracted implementations
are compatibility reexports; apply fixes at the new owners. Keep the
Safe Bash adapter thin. Use structured parser/model nodes and vetted cryptographic
primitives. Each code fix needs a current failing original memory test or other
concrete evidence, neighboring controls and narrowly maintained verification.

CSVKit now uses owned cached-value XLSX and BIFF readers, shared coordinates and
local format classification. SheetJS remains only a CSVKit test dependency.
The namespace-aware parser belongs to `xml-ast`; `safe-fs/xml` retains parser/error
identity. Pandoc and ssconvert use the owned JPEG implementation. Preserve these
boundaries while qualifying further workbook and rendering profiles.

XLSX imports preserve raw ISO dates, declared/reset dimensions, formats, epoch and
active sheet. BIFF imports skip formula/name translation and formatting-only blanks,
preserve raw errors and empty string caches, and use populated-cell extents.
CFB, record, string and cell allocations share caller work/storage counters.
Pinned xlrd 2.0.2 (`3a19d22014d7b3f3041b7188d21a653c18c709bf`) supplies the
cached profile: legacy encoding overrides beat CODEPAGE, the missing-encoding
fallback is ISO-8859-1, and BIFF8 ignores legacy overrides. BIFF4 workbook containers
reset per-sheet formats; BOUNDSHEET order controls sheet selection. Keep the
Gnumeric editing reader's separate formula, font and encoding semantics.
The library and adapter are delivered as `265df71418` and `daf450b6a8`; current
registry artifact qualification and the broader format-family scope remain open.

The incoming synchronous XLSX shortcut dropped sparse row positions. Fix
`52134c3627` delegates non-dense coordinates before output; dense conversion and
actual Shell substitutions pass the 95-test command cohort. Broader shortcut
format/resource equivalence remains unqualified and part of this plan.

Live Lotus name references are delivered in `2f95e87916` and `7aa2721cff`.
Definition edits and deletion now affect imported formulas; per-use copy modes
preserve relative/absolute axes and existing qualified-sheet behavior. Tab moves
and renames retain copied names’ sheet identities and later definition edits. Native
XML/XLSX/BIFF transport remains unfinished and refuses these tokens rather than
silently dropping identity or relocation. Complete native copy/move qualification
before closing this family. The ledger records focused and compiled evidence.

The release follow-up includes Pandoc registry lookup (`683adeb82b`), isolated
public runtime (`56af2a197c`), root-owned declarations (`01fd535e84`) and Node-only
codec types (`506dd331a7`). A fresh 24-workspace SafeJS rebuild preserves all
1,513 public declaration files byte-for-byte and compiled SDK/CLI behavior.
The maintained consumer route passes 26 public groups, six source groups and
three rejection controls. Final integration retains upstream scoped runtime
mapping and passes 228 packaging checks and root lint. Full build passed before
the last upstream integration; this is not a frozen final-revision unit result.
Release metadata assertions are reconciled in `9c990638d7`; all 20 checks pass.
Verify containing publication and installed registry consumers before closing
the artifact family. Keep the private-import rejection guard intact.

The selected-format command exports are delivered in `e765e7c23d`.
Keep file-output budget and cancellation ownership in `safe-bash-contracts`.
The root SDK and Shell use the declared shared-workspace contracts runtime for
both Node and browser profiles. Preserve that canonical identity through the
root bundler and scoped packaging. Emit the public ssconvert SDK under
`dist/ssconvert` and shared runtime under `dist/shared`, separately from private
workspace output. Verify that workspace rebuilds preserve public runtime imports. Verify cross-bundle
raw arguments, file budgets, cancellation and installed consumers before claiming
extraction complete.

PERL_SED capture/assertion conditions (`577d74b048`), branch-reset groups
(`3e7fdf1615`), numeric-condition semantics (`7b7d675077`) and alphabetic
lookaround/atomic spellings (`a1d80828a7`) and explicit backreference spellings
(`36649a7edf`) are on remote main.
Pinned Perl documentation/compiler source and standalone Perl 5.34.1 support
the grammar changes. All 4,738 focused tests pass; the first four cohorts match
81 native outputs through the compiled root SDK/command, including raw bytes.
The final backreference cohort matches 19 outputs through the compiled command
package and refuses 14 native-invalid spellings.
The maintained root build passes 251 declared builds and its root suffix stages.
Qualify all five through the final root artifact, containing release and activated
Gnumeric loader. Wider grammar, Unicode and
diagnostics remain open. Release `36598284494` failed fresh units and Bash 1;
its declaration/browser/archive fixture failures are repaired. Final archive
controls pass 265 tests with one explicit-input qualification skip; the rebased
browser/public/facade cohort passes 67 tests and root ESLint passes.
Pin `36606002535` at `b00b184630` contains the first three repairs and is pending;
the two spelling repairs were pushed afterward. Publication and
installed artifact qualification remain unverified. Preserve the independently
delivered root/scoped fixture separation `61baed7701`.

| Family | Remaining acceptance (existing scope) |
| --- | --- |
| PWD/resource identity | 1. Native Windows logical/physical PWD, symlink and logical-alias identity, with exact GETENV and diagnostic paths through installed SDK/Shell. 2. Real-adapter input/export/write, staging/split/graph, cancellation and cleanup controls; containing installed artifacts. |
| Lotus names/formulas | 1. Live-name XML/XLSX/BIFF transport: edit/delete definitions and copy/move formulas in both copy modes; preserve target identity and recalculation. 2. DOS Works ambiguity, modern range flags, sheet-relative references, remaining offsets/charsets/formatting and native application profiles. |
| BIFF formulas | 1. BIFF7 external multi-sheet ranges and live-label NAME export: independent readback, edit/recalculation and exact diagnostics. 2. Remaining token/version/context and label radical/extra-data/deleted/pivot profiles, metadata and XML/XLSX/ODF/BIFF7 transport; never acquire external links implicitly. |
| Encrypted BIFF | 1. Remaining version/password/encoding and ancillary-stream profiles, including truncation, resource ceilings and cleanup; classify Calc CryptoAPI refusals/property loss separately. 2. Containing installed root/scoped artifacts through SDK/command; retain the completed 27-profile command cohort and POI metadata/edit evidence. |
| Encrypted ODF | 1. Remaining password/encoding, package/path, truncation/tampering and application profiles with bounded KDF/work, cleanup and no invalid plaintext publication. 2. Containing installed artifacts; retain six-algorithm command evidence and classify Calc CFB8/empty-password limitations separately. Legacy prefix checksums are not full authentication. |
| Encrypted Paradox | 1. Companion-file and wider block/record/version profiles through SDK and command export; native reopen must preserve schema/records and exact diagnostics. 2. Remaining password, truncation, work/cleanup and installed-artifact controls; do not claim authenticated encryption. |
| PERL_DATE | 1. Zero-argument signature and scalar/error/reference/array/multiple-argument rejection are qualified in C/C.UTF-8. Complete remaining declared locale/runtime profiles; do not invent supported argument coercions. 2. Containing root publication with explicit profile selection and remaining installed runtime profiles; retain the 120 registry argument/locale results and qualified 92-case five-zone date cohort. |
| PERL_SED | 1. Retained corpus classification and bounded 12-case Unicode/raw-byte/NUL transport are complete. Preserve native atomic state limitations and malformed-byte XML exclusions; remaining grammar and installed-runtime scope stays open. 2. Remaining bounded grammar, Unicode/raw bytes, malformed inputs and lifecycle through activated and installed routes; keep original interpreter goldens. |
| PY_PRINTF | 1. Remaining coercion and diagnostic profiles within the native loader value kinds: boolean, float, string, range, array, error and empty. Sheet/tuple helper APIs are not PY_PRINTF arguments; retain their historical native crash evidence without treating them as an unimplemented formatter API. 2. Remaining API/runtime and installed consumers; classify native crashes and XLSX control-character loss separately from formatting. |
| PY_CAPWORDS | 1. Root containing publication for custom-error XLSX quoting; scoped0.1.815 and root17.0.41 selected-version casing/context and namespace contracts are qualified on Node22/26. Retain11637 native cases and all3 Unicode-profile controls. 2. Remaining optional-runtime and diagnostic profiles; preserve portable malformed-input refusal where native UTF-8 probes crash. |
| Database functions | 1. Explicit in-memory SQLite in-flight cancellation, read-only transactions, provider credential admission and connection retirement are qualified. Extend only to remaining provider-specific lifecycle profiles; preserve original cancellation identity and zero publication. 2. Remaining provider-specific types and installed non-SQLite profiles; root/scoped SQLite lifecycle is qualified on Node22/24. Retain native CLI crash and classified GDA integer-inference/SQLite tiny-number profile differences as compatibility limitations. |
| ATL_LAST | 1. Root containing conditional-unlink publication and remaining declared deployment profiles. Scoped0.1.817 conditional deactivation/reactivation is qualified on Node22/24/26 through installed SDK/command APIs; retain earlier schedule/mutation/feed-close receipts. |
| LN1P/log1p/acos | 1. Root containing publication for capturedAcos and remaining declared runtime-library profiles using retained cohorts; preserve mathematical LN1P versus captured Linux rounding and existing work/cancellation contracts. |
| Higher-q Bessel | 1. Root containing publication for bounded Bessel repairs; independent uncovered fractional/near-integer and high-order boundaries. Scoped0.1.815 retained4256-case registry cohort is qualified on Node22/26; preserve those receipts. 2. Remaining domain/runtime profiles, warnings/errors and work ceilings; retain explained Darwin libm/FMA differences and all 3296 qualified matches per route. |
| Format records | 1. Existing directional-service matrix: remaining rich-comment metadata/geometry beyond retained note rectangles, print and protection flags, native rendering and independent edit/readback. Raw-NUL formula wire/public export is qualified; retain native Gnumeric escape-decoding limitations. 2. Remaining formula/name/style/encoding/metadata/merge/chart/object/link semantics and installed composition; explicit loss diagnostics for unsupported records, not opaque-preservation claims. |
| Rendering | 1. Remaining weak/neutral/explicit bidi and shaping-direction overrides, rich text/fonts, decorations/merged multipage, print spans and chart profiles with independent visual evidence. 2. Current installed/public rendering composition; reuse completed Fill/tab/control cohorts rather than generating new permutations of them. |
| Solver/analysis | 1. Independent solver factories: report diagnostics/layout, sensitivity and nonlinear boundary models through SDK/command against known solutions and native results. Retain the completed degenerate dual-basis and max/min public controls with classified native differences. 2. Remaining solver/analysis numerical/error/lifecycle and installed profiles; program installation alone is not qualification. |
| Optional profiles | 1. Original glossary saver gsf dependency and actual output in its authenticated profile; retain exact unavailable-service outcome if still unavailable. 2. All eight activation environments and fourteen existing capability obligations: exact plugin sets, results/effects and lifecycle; resolve or explicitly retain GNOME-DB ui.xml, GDA CLI and Perl reference limitations. |
| Public artifacts | 1. Containing registry root/scoped artifacts installed outside the repo without private workspace or native PATH: strict NodeNext and SDK/Shell conversion/edit/readback. 2. Maintained Node/browser/worker/workerd matrix: canonical runtime identity, raw bytes, budgets, authority, cancellation and cleanup with exact artifact/version hashes after relevant incoming changes. |

Encryption qualification includes correct/wrong/empty/binary passwords, encoding,
tampering, truncation, unsupported versions, KDF/work ceilings, chunks, cleanup and
no invalid plaintext publication. Describe unauthenticated legacy formats honestly.
All functions preserve namespace replacement and absent-plugin behavior. Never
remove difficult numeric inputs or relax exact comparisons to obtain a pass.

Three retained checkpoints are complete: mixed Fill control order
(`pdfMixedFillControlOrder`), the 27-profile BIFF command cohort
(`encryptedBiffCommandParity`) and the six-algorithm ODF command cohort
(`encryptedOdfCommandParity`). Their receipts include independent readback and
failure controls; the encryption receipts retain native application limitations.
The table above mirrors each ledger case's `remainingAcceptance` list. It replaces
stale routing from rendering to BIFF to ODF: retain the completed Paradox version/companion-absence checks.
Do not repeat completed cohorts unless a relevant runtime change or regression
invalidates their evidence. Family closure still requires the listed acceptance
and its independent evidence; this reconciliation does not qualify new profiles.
Publication/installed-artifact gates remain separate from remote-main delivery.
Paradox inline memo UTF-8 corruption is repaired (`paradoxInlineMemoUtf8`):
plaintext/encrypted SDK and command routes preserve Unicode and do not access
companions. External companion content remains open; native unterminated memo
allocation remains a reference limitation, not a parity pass.
Memo M/F export also honors the native NUL boundary before testing inline
capacity (`paradoxMemoNulCapacity`), removing false companion-loss warnings
while retaining true overflow diagnostics. This does not qualify external blobs.
The bounded encrypted type-2 version-ID 3–15 cohort is complete
(`paradoxVersionRoutes`): 13 native direct-file inputs and 52 public exports
pass pxlib reopen. Current Gnumeric/GSF header refusal remains a separate
reference limitation. Companion absence/authority is now also complete
(`paradoxCompanionAbsence`):16 public controls and two native pxlib inputs
agree on the exact warning and preserved unaffected value; cancellation publishes
nothing. Actual companion content/index semantics remain open. Proceed to the
PERL_DATE installed-artifact gate without restarting these cohorts.
Genuine pxlib-generated DB/MB payloads now validate the default-reading contract
(`paradoxCompanionContent`):16 compiled public controls preserve the unaffected
short value, exact warning and cancellation atomicity without reading companions.
Explicit native attachment recovers the89-byte plaintext memo byte-exact. For the
native-generated encrypted pair, pxlib returns success and length89 but a null
payload; the corrected evidence harness reports that limitation without
dereferencing it. Gnumeric/GSF still refuses the genuine table at header loading.
These results qualify neither implicit companion loading nor encrypted external
memo parity. Primary-index content and the wider remaining profiles stay open.
Alpha fields now apply the same native NUL boundary before encoding and warning
admission (`paradoxAlphaNulBoundary`). Twelve public exports preserve prefixes
and match independent pxlib schema/field bytes; genuine prefix overflow still
warns. Eight ASCII application readbacks pass under an explicitly documented
GSF byte-count adapter. The installed pxlib callback casts a pointer to int; the
adapter corrects only that return value and does not establish unmodified-profile
parity or CP1252 application support in the library built without reencoding.
BCD fractional conversion now skips non-digits until precision or NUL
(`paradoxBcdFractionDigits`);16 public encrypted/plain outputs match independent
native bytes and adapted-GSF application readback. The native writer underflows
an unsigned reverse index on short integral strings. Those failed controls remain
recorded separately; the qualified cohort uses30 integral digits to bound that
scan without modifying native BCD logic. Wider profiles remain open.
The300-record/two-block primary-index cohort now passes16 public CSV/XLSX
routes, preserving signed/null trailers and block numbers; all8 XLSX outputs
reopen exactly in native Gnumeric without diagnostics
(`paradoxIndexApplicationReadback`). The encrypted fixture explicitly restores
the key omitted by the native index writer; its original failure remains retained.
All65 hash-verified version inputs/exports also pass application readback under
the GSF byte-count adapter. Keep that adapted-profile result separate from the
original header refusal and unavailable native reencoding support.
PERL_DATE takes no arguments: the activated sample and eight compiled public
routes match all ten scalar/error/reference/array rejection and valid-call
controls in C/C.UTF-8 (`perlDateArgumentLocale`). Broader locale/runtime profiles
remain separate. The native loader required task-local libtool relocation; its
binary and sample source were unchanged.
Registry-installed `poe-code@17.0.41` (default provider) and
`@poe-platform/safe-bash@0.1.812` (both Perl profiles) now match 120
SDK/command results with native tools absent from PATH; strict public consumer
types pass (`perlDateRegistry`). The root release predates the profile factory
already exported by current source. Qualify that containing publication next;
retain these results and the earlier 92 date-boundary cases. No new runtime
fix, clock-boundary or lifecycle qualification is claimed.

The retained PERL_SED corpus classification is now complete
(`perlAtomicHarnessClassification`): all 18 activated atomic-lookbehind
discrepancies change with the native harness across 270 observations. Keep them
as reference limitations, not parity passes. Version selection, match reset and
experimental warnings already have receipts. The bounded byte transport gate
is also complete (`perlByteTransport`): 12 native cases, 24 memory regressions,
60 public result values and eight cancellation/output-admission controls.
Malformed-byte arguments use workbook values and raw SDK export; the XML
conversion subset has nine valid-text cases. Containing installed profiles and
remaining grammar/runtime acceptance stay open.

PY_PRINTF now refuses malformed byte-string arguments through the existing
Unicode rendering guard instead of formatting their internal hexadecimal storage
(`pythonPrintfByteAdmission`). This covers format strings, scalar arguments and
array members across all three profiles; RangeRef and installed-profile gates
remain open.

Precision-limited Python scalar/array representations now stop before allocating
unused suffixes (`pythonPrintfPrecisionAdmission`). Five formerly refused short
outputs fit their eight-byte limit; genuine UTF-8 and padding overflow still
fails. This does not qualify unstable RangeRef addresses or installed profiles.

The explicit SQLite lifecycle gate is complete (`databaseInflightLifecycle`):
12 SDK/command conversions verify in-query cancellation, transactions, provider
credential admission and retirement of all ten acquired connections. This uses
cooperative SQLite callbacks and host credentials, not server authentication or
blocked-socket interruption. Retained native type discrepancies and remaining
provider/runtime profiles are the next database acceptance gate.

The retained database type discrepancies are classified
(`databaseProviderTypeClassification`): GDA infers signed 32-bit integers, while
explicit 64-bit column types preserve all six boundary values. The tiny-number
difference originates in Node SQLite before conversion (one binary64 step below
the native profile). These remain provider compatibility limitations; no global
spreadsheet coercion change is justified. Continue with remaining installed and
provider/runtime profiles, without repeating these 41 query controls.

Published root17.0.41 and scoped0.1.812 database lifecycle contracts are now
qualified on Node22/SQLite3.51.2 and Node24/SQLite3.53.4
(`databaseRegistryLifecycle`). All48 SDK/command conversions pass, including
eight in-query cancellations and retirement of40connections; strict public
TypeScript consumers pass. Remaining database work is provider-specific types
and non-SQLite profiles, with the native limitations preserved.

ATL_LAST session polling now releases subscriptions when a recalculated
conditional stops reading a tag (`datasourceConditionalUnlink`). Direct and
dependency-triggered branch changes, reactivation and split-read public routes
pass. Remaining native FIFO schedules and installed/deployment profiles stay open.

The 12-phase native FIFO split-read/writer-reopen/dynamic-tag checkpoint is
complete (`datasourceNativeSchedules`): 24 native values match a persistent
compiled session, and 24 SDK/command snapshots match 48 derived values with
exactly-once cleanup. The explicit task profile has 49 active plugins. Remaining
ATL_LAST work covers formula replacement/deletion, abnormal close/error ordering
and containing installed/deployment profiles; retain the completed schedules.

The remaining bounded formula-mutation/feed-close checkpoint is complete
(`datasourceMutationAndClose`): native replacement, removal and restoration
match the compiled session and public snapshots. Eight failure controls verify
cleanup and route-specific error reporting. Close-only failures can follow valid
output; they do not roll back published bytes. Continue with containing installed
root/scoped and deployment profiles, including the conditional-unlink fix.

Published datasource contracts now pass 160 root/scoped SDK/command conversions
on Node22/24 without native tools in PATH (`datasourceRegistryDeployment`).
Public TypeScript types pass. Scoped0.1.813 was published before the conditional
unlink fix, and its installed code lacks that callback; root remains17.0.41.
Keep containing-release qualification separate from the verified main fix and
these passing registry contracts. Remaining declared deployment profiles stay open.

The independent numeric boundary checkpoint is complete
(`numericBoundaryProfiles`): 285 exact LN1P inputs and raw/public special-value
controls pass on Node22/26. All 1,200 public outputs match their declared
contracts. Public LN1P retains independently verified mathematical rounding;
captured Linux kernels retain native rounding, including two classified one-ULP
differences. Installed qualification (`numericRegistryProfiles`) captures 27,840
values across root17.0.41/scoped0.1.813 SDK/command routes on Node22/26. Scoped
passes all retained cohorts; root passes LN1P/special controls but retains 218
ACOS differences per route/runtime. Its bundle still calls Math.acos; scoped
uses capturedAcos. The source fix is already on main. Root containing
publication and remaining declared runtime-library profiles stay open.

The retained12 alpha NUL exports now pass independent application readback,
including CP1252 café, with empty stderr (`paradoxIconvApplicationReadback`).
This uses an isolated pinned-upstream iconv plugin and the explicit GSF callback
adapter; installed reference binaries remain unchanged. The original Debian
no-reencoding profile remains separately classified. Wider Paradox acceptance
and all other family gates remain open.

Paradox alpha export now matches bounded native iconv overflow loss
(`paradoxAlphaConversionOverflow`): oversized converted fields become null,
while fitting values, NUL prefixes and length warnings remain intact. Four
regressions,90 focused tests and20 public/native readbacks verify the repair.
Native exporter schema use-after-free and exact-buffer terminator overflow
are classified separately; remaining family acceptance stays open.

Paradox schema specifications and table names now stop at NUL
(`paradoxSchemaNulBoundary`). Seven regressions,97 focused tests,12 public/native
readbacks and four invalid-schema authority/publication controls verify the
repair. Wider Paradox and other family acceptance remains open.

## 4. Interfaces and test plan

Use existing `createEngine`, `readWorkbook`, `writeWorkbook`, `convert` and
`runCommand` contracts; update public type consumers when contracts change.
Extend `Workbook`, `Sheet`, `FormulaNode` and declarative codec/provider metadata
at their actual owners, with snapshots and bounded accounting.

For each family, record source/profile/candidate hashes, smallest reproducer,
neighboring controls, applicable behavior, remaining scope and current proof.
Historical mismatch counts and earlier installed artifacts are not current proof.

- [ ] Every table row has current implementation and independent evidence in the ledger; applicable unknown cells and missing profiles are resolved.
- [ ] Each code repair has failing-before/passing-after evidence and appropriate package checks: `npx vitest run <exact files>`, `npm run lint --workspace=safe-bash-command-ssconvert`, and the selected maintained workspace build.
- [ ] Execute the source-authenticated native procedures in `ssconvert-reference-qa.md`, `ssconvert-biff-label-ranges-qa.md`, `ssconvert-database-file-codecs-qa.md` and `ssconvert-audit-qa.md`; record observations, not merely command exit codes.
- [ ] Run actual compiled SDK and command conversions for each changed profile. Independently decode native output records and recalculate in the matching application. For live label scalar/SUM cases require fresh values 2/5 from stale cache 999, preserved tokens and correct behavior after editing the former data gap.
- [ ] Execute installed artifact conversions outside the checkout with native commands absent from PATH; independently read edited output and compile strict consumers. Inspect actual CLI diagnostics and rendering screenshots.
- [ ] Before final integrated acceptance, run the maintained root build, tests and lint routes; fix failures and timeouts. A focused package result cannot close the complete integration gate.
- [ ] Verify each delivered commit's ancestry on remote main, required CI, actual registry version/provenance and installed release behavior separately. Complete the goal only after every requirement is proven.

## 5. Code plan

1. Repair active ledger/plan links and keep current findings concise. Use
   `docs/ssconvert/gap-resolution.json` for receipts and all 19 open rows.
2. Continue `packages/spreadsheet-format-xls/src/{biff-formulas,biff-write-formulas,biff}.ts`
   and `packages/spreadsheet-engine/src/formulas/{ast,parser,serialization,rewriting,label-references,dependencies}.ts`:
   complete flag, subtype, context and transport behavior from pinned sources.
3. Drain validated defects at the AST, engine and format owners above, plus the
   remaining command codecs, rendering, solver and explicit service adapters. Preserve unrelated
   work. Implement each atomic improvement with its own commit and delivery.
4. Update existing package/root support text and relevant public consumers as
   behavior changes. Qualify native and public profiles while releases run.
5. Reconcile the ledger with current evidence, finish integrated acceptance and
   monitor the containing release through publication. Retain only compact
   necessary provenance; put raw outputs in ignored `out` and purge consumed
   captures. Do not reintroduce the historical 70 KB rolling plan log.
