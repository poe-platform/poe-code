---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: Resolve ssconvert functionality and compatibility gaps
readiness: draft
setup:
  prompt: >-
    Resolve the ssconvert gaps recorded in docs/ssconvert/gap-resolution.json. Follow applicable
    AGENTS.md and current user instructions. Validate failures before fixes, use fast memory-based
    TDD, preserve explicit host authority, cancellation, budgets, cleanup and CLI/SDK parity. Commit
    atomic improvements to main, verify remote delivery and monitor publication. Keep only concise
    current status and required fixtures/provenance in the repository; temporary downloads, raw
    captures, screenshots, profiles and logs are disposable and must be purged. Use existing
    canonical tooling and focused maintained checks. Do not close a family while required behavior
    or qualification remains unresolved.
tasks:
  - id: current-gap-inventory
    title: Authenticate current gaps and reference environment
    prompt: >-
      Read docs/ssconvert/final-coverage-and-delivery.json, usage-draft.md, function-coverage.json,
      optional-runtime-extension-coverage.json and numeric-current-verification.md. Inspect
      subsequent packaging/portability commits 7d97a1731 and d53488b24 before repeating stale
      findings. Create a structured case ledger covering every requested family with
      source/profile/candidate hashes, actual code owner, native applicability, smallest reproducer,
      neighboring control, classification and completion proof. Resolve prior reference-profile
      binding drift without editing hashes into apparent passes. Provision authenticated native
      Gnumeric in isolated out using an available Linux host/container or build environment; no
      Docker/ssconvert binary is initially on PATH. Read external-service adapter contracts and set
      up isolated owned fixtures where required. Record absent runtime cells as unresolved and keep
      progressing on independent deterministic work.
    status:
      implement: open
      commit: open
      release: open
  - id: pwd-resource-identity
    title: Align actual cwd, resource identity and diagnostics
    prompt: >-
      Inspect packages/ssconvert/src/contracts.ts, engine.ts, io/index.ts, io/publication.ts and
      resource-uri.ts plus packages/safe-bash/src/commands/ssconvert/index.ts. Reproduce conflicting
      PWD and actual VFS cwd with an original public-engine/Shell test. Carry actual
      working-directory identity through an explicit SDK environment or resource contract, preserve
      GETENV(PWD) and exact exported environment rather than overwriting user variables, and qualify
      logical symlink-equivalent names only through explicit filesystem identity. Cover
      relative/absolute paths, missing input, exporter inference, write failures, output staging,
      split/graph outputs, missing/empty PWD and cancellation. Inspect visible diagnostic
      screenshots and public type consumers.
    status:
      reproduce: done
      implement: done
      test: open
      commit: done
      release: open
  - id: lotus-named-ranges
    title: Implement applicable Lotus named-range semantics
    prompt: >-
      Inspect codecs/lotus.ts and lotus metadata/formula/workbook name owners. Validate the current
      Named ranges not implemented diagnostic against the authenticated native source; if native
      also lacks this behavior classify native parity separately while implementing the requested
      useful capability. Add original small WK1/WK3 records for global/local names, ranges,
      relative/absolute refs, duplicates, case, invalid lengths and references, then expose imported
      names through the actual workbook model and recalculation. Preserve unknown records, sheet
      ownership and neighboring Lotus fixtures; qualify Gnumeric XML/XLSX export and readback.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: biff-external-and-token-formulas
    title: Complete applicable BIFF formula read/write support
    prompt: >-
      Inspect codecs/biff-formulas.ts, biff-write-formulas.ts, biff.ts and the explicit
      externalReferences capability. Inventory every currently refused token and version,
      SupBook/ExternSheet/name ownership and Gnumeric behavior. Implement external-workbook and
      detached-sheet references and remaining applicable tokens using structured formula nodes; no
      automatic link fetch, execution or silent cached-value substitution. Read/write cross-check
      original BIFF version fixtures, shared/array formulas, missing bindings, invalid
      indices/spans, cancellation and round-trip names. Preserve external-reference identity and
      effects in XML/XLSX and SDK/Shell output.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: encrypted-format-admission
    title: Define encrypted-format contracts from actual native support
    prompt: >-
      Validate encrypted BIFF Excel, OpenDocument and Paradox refusals against actual native support
      and primary encryption specifications. Inspect office-package crypto and codec reuse plus
      contracts.ts, cli.ts and providers. Define per-format password/secret acquisition, errors,
      decrypt-only/write support, format/version algorithms, byte/work bounds, CLI/SDK parity and
      authenticated publication. Secrets are explicit host inputs, never argv/debug/log output or
      ambient config. Native itself refusing a format is evidence of compatibility, not
      justification for declaring requested encryption support delivered. Record unsupported
      algorithms explicitly and schedule their implementation if applicable to the requested target.
      Do not fabricate a universal password flag.
    status:
      implement: open
      commit: open
      release: open
  - id: encrypted-format-implementation
    title: Implement and independently qualify applicable encryption
    prompt: >-
      Use the validated format-specific encryption contracts and primary published vectors, never
      invent crypto. Reuse vetted available primitives; add a shared owner only when required.
      Deliver each format/algorithm as its own atomic improvement. Cover correct/wrong/empty
      passwords, binary passwords and encoding, tampered headers/payload/authentication, unsupported
      versions, truncation, excessive KDF/model work, encrypted package paths, stream chunks,
      cancellation and no invalid plaintext/output publication. Compare native cross-read where
      supported and independent format tools where native lacks the requested extension. Document
      any unauthenticated legacy cipher behavior honestly; no strength or authentication claim from
      parsing a header.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: optional-language-functions
    title: Complete required Perl/Python scalar functions and Unicode
    prompt: >-
      Inspect formulas/optional-providers.ts, runtime-functions.ts and optional-runtime
      coverage/source receipts. Implement PERL_DATE, PERL_SED, PY_PRINTF and Unicode PY_CAPWORDS
      through bounded compatible semantics, pinned runtime Unicode/casing/whitespace and
      locale/timezone profiles, explicit clock and existing shared interpreter capabilities where
      suitable. Preserve sample signatures, coercion, error/array conversion, namespace replacement
      and default absent-plugin behavior; explicit opt-in remains. No arbitrary native module
      loading or unbounded JS RegExp substitution. Source-disabled Guile/debug/external manifests do
      not become new shipped APIs. Differentially qualify Unicode expansion/surrogates, formatting
      flags/width/precision/errors, pattern grammar/captures, dates/DST and cooperative
      cancellation.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: optional-data-and-stream-services
    title: Complete required database and ATL lifecycle services
    prompt: >-
      Inspect authenticated GDA/ATL source and contracts for EXECSQL, READDBTABLE and ATL_LAST.
      Provide declarative explicit trusted data-source/FIFO adapters with namespace/array result
      conversion, diagnostics, ordering and bounded watcher lifetime. Never discover ambient DB
      credentials or host FIFOs. Match transaction/error/resource ownership and cancellation with
      real isolated fixture services as manual Markdown QA plus fast injected unit controls. Prove
      actual result bytes/database effects and retire owned connections/watchers before settlement.
      Inventory loader/extension initialization effects relevant to CLI; exclude GUI-only and
      source-disabled services only with exact source evidence.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: numeric-current-reproduction
    title: Reproduce and minimize current numerical differences
    prompt: >-
      Read numeric-current-verification.md, numeric-current-*-comparison.json,
      numeric-current-gates.json and actual numeric primitive/function owners. Re-run the recorded
      direct LN1P/log1p/acos and higher-q Bessel cohorts against compiled current source and
      authenticated matching oracle. The historical 56 differing cases are not 56 missing functions
      or a current verified failure count. Retain exact binary64/HEXREP expectations, profiles,
      seeds, route/ULP/relative errors and minimized original deterministic regressions. Discard no
      hard input to obtain parity. Classify native rounding versus mathematical accuracy explicitly.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: numeric-current-repairs
    title: Repair validated numerical-route mismatches
    prompt: >-
      For every minimized current failing numeric regression, repair the responsible shared
      primitive or route with TDD and independent holdouts. Qualify LN1P public domain before wiring
      private log1p; preserve source FMA/order/reflection/phase semantics for Bessel and acos. Cover
      signed zero, subnormal/overflow, poles, NaN/infinity, integer order, high-q regimes, errors,
      work cancellation and replay. Keep expensive broad oracles in Markdown manual QA; small fast
      unit vectors prove each repair. Each algorithm improvement has its own commit and relevant
      ledger update. Never silently relax exact compatibility into a tolerance pass.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: format-record-roundtrip
    title: Close format/version/record semantic coverage
    prompt: >-
      Use coverage.json, canonical differential register and codecs/provider manifests to map every
      applicable importer/exporter version/record effect to executed cases. Distinguish preserved
      opaque bytes from understood/recomputed semantics and diagnostic loss. Qualify styles, names,
      formulas, merges, comments, charts/objects, external links, unsupported records, encodings and
      metadata through independent parse/edit/export/readback. Reduce every defect to original small
      memory fixtures and repair before marking the row complete. Resolve generated/conditional
      semantic inventory omissions and unknown case counts rather than claiming full support from
      exporter listings.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: rendering-and-solvers
    title: Qualify charts, printing, fonts, solver and analysis accuracy
    prompt: >-
      Inspect rendering/chart, rendering/print, rendering/images, codecs/pdf, solver and analysis
      owners and matching source/profile registers. Execute independent chart/print screenshots, PDF
      text/geometry/font checks, page-break/range/header/footer cases, Unicode/CJK/RTL where claimed
      and clipping/style/object fidelity. Validate goal-seek/linear/nonlinear optimization and
      analysis against known solutions plus matching native optional profiles; an installed solver
      or callable stub is not accuracy evidence. Repair reproduced defects with fast unit controls
      and separate bounded manual QA. Record unavoidable platform-dependent rendering profiles
      explicitly without silently shrinking required support.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: public-and-optional-qualification
    title: Verify optional profiles and packed public consumers
    prompt: >-
      Qualify all applicable optional profiles recorded in optional-runtime-extension-coverage.json
      against activated authenticated references and actual services; source-disabled/GUI-only
      distinctions remain documented. Revalidate packed poe-code/ssconvert and scoped safe-bash
      command exports after the existing bundling fixes. Install artifacts outside the repo with no
      private workspace resolution/native PATH, execute real XLSX to CSV and edited CSV to XLSX
      readback through public SDK and Shell, compile strict NodeNext consumers and check
      worker/browser startup where advertised. Test CLI/SDK parity, authority controls,
      cancellation/cleanup and replay. Use a different stress/fix agent for Safe Bash integration as
      scoped policy requires.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: final-acceptance-and-publication
    title: Close the ledger and verify complete delivery
    prompt: >-
      Reconcile every requested case and every applicable claimed-support obligation to current
      executed evidence. Rewrite stale blockers after actual proof, preserve historical failed
      attempts and distinguish implemented/verified/excluded/unavailable. Update existing usage and
      support text without adding unrequested root README sections. Run maintained npm run build,
      npm test and npm run lint for the integrated broad change, investigate failures and timeouts,
      inspect visible CLI and document screenshots, then deliver verified atomic commits through
      normal main hooks. Verify remote-main ancestry, successful required GitHub workflows, actual
      registry versions/provenance and installed-artifact smoke. Notify the user through authorized
      hey-boss only once ready. No automatic archive, full parity declaration or goal completion
      with required work remaining.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
teardown:
  prompt: >-
    Reconcile the current structured ledger and publication outcomes. Keep goal active and report
    exact unresolved requirements unless every mandatory case has been resolved and required remote
    delivery/publication verified. Preserve unrelated changes and historical failed evidence. Clean
    only task-owned ignored scratch; no blanket staging or archive.
finalization: pending
---

# ssconvert gap resolution

Resolve the requested gaps against Gnumeric 1.12.61 and applicable format specifications. The current [case ledger](../ssconvert/gap-resolution.json) retains all 19 families; all remain open. Keep implementation progress separate from complete compatibility claims.

The pipeline above defines the work and acceptance requirements. Validate each issue against current source, repair it with focused tests, check the maintained package routes, and deliver an atomic Conventional Commit. For visible CLI changes, inspect an ad hoc screenshot. Verify remote main and successful publication separately.

Current implementation: LibreOffice Argon2id v19/AES256-GCM package import and explicit export use cumulative ZIP/XML/work limits, a default 64 MiB Argon2 arena cap, authentication before inflation, cancellation and owned-buffer disposal. Independent Python crypto authenticated six real exports (both writers, ASCII/Unicode/empty passwords). LibreOffice 26.8 reads both writers’ ASCII/Unicode outputs and refuses wrong or empty passwords; SDK readback supports empty passwords. Modern browser/worker SDK and Node Shell routes are qualified separately. The standalone browser Shell needs a Buffer host dependency and remains unqualified. Verification passed 23,296 package tests, 635 ODF tests, maintained lint/types and the selected build closure.

BIFF8 standard RC4 and CryptoAPI 40–128-bit exports use explicit password/entropy capabilities and bounded cryptographic work. Independent PyCryptodome and xlrd read 120 CryptoAPI samples across all 12 key sizes, five password cases and small/multi-block containers. msoffcrypto-tool 6.0.0 independently reads its 50 supported-key-size cases; its cryptography backend rejects seven other key sizes, which are not counted as msoffcrypto passes. CFB output uses exact lengths and mini sectors, independently checked with olefile and xlrd. Public Node Shell passes all 12 key sizes; 96 browser/worker SDK cases pass with the screenshot inspected. Maintained package tests, lint/types and selected build pass. Native applications, ancillary streams and other encryption profiles remain open.

XOR export supports BIFF7, BIFF8 and both DSF streams with one explicit 1–15-byte password and no entropy. All 114 compiled SDK files reopen; independent Method 1 decryption matches all 152 plaintext streams after accounting for FILEPASS offsets. xlrd reads 114 streams fully; its 38 continued-BIFF7-LABEL truncations also occur on plaintext. Gnumeric 1.12.61 `ms_biff_query_next` concatenates these continuations, unlike xlrd 2.0.2. msoffcrypto reads all 76 BIFF8/DSF primary streams. Node Shell passes 30 cases and browser/worker SDK passes 60 with its screenshot inspected. The package passes 23,370 tests, lint/types and the selected build. Empty export passwords are refused because Method 1 key derivation is undefined; existing empty-password import is preserved. Native application qualification remains open.

Logical PWD aliases now resolve through the public `resolveVfsCwd` helper before SDK/Shell resource binding. POSIX GLib/GIO 2.90.0 confirms matching-directory aliases and distinct/missing/empty fallbacks. Scoped numeric or opaque identity is required; metadata snapshots preserve getter-backed fields and zero identities. Focused tests, independent stress probes and compiled public consumers cover alias diagnostics, relative-parent publication, unchanged environment, cancellation and fallback. The real POSIX adapter also passes missing-input, inference and relative-parent publication checks in an isolated owned tree. Split and graph outputs use the same logical parent; visible diagnostics were screenshot-inspected. Native Windows, broader real-adapter and installed-package qualification remain open. Identity observations do not provide namespace leases.

External-reference serialization now quotes workbook names containing whitespace, closing brackets or leading quotes. These identities survive Excel/ODF/Gnumeric conversion, relocation and local sheet renaming; recalculation still requires the explicit external-reference capability. Raw quote syntax uses an available delimiter or refuses an unrepresentable name for both cell references and named expressions. Apostrophes in raw external names retain workbook and sheet scope instead of producing invalid SYLK formulas. Remaining BIFF external-workbook records remain open.

Legacy BIFF relative rows now wrap at 16,384 instead of the BIFF8 limit of 65,536. Five failing boundary/name tests reproduced the error; 858 BIFF tests across 41 files pass after the fix, with package lint/build and compiled SDK/Shell XML/XLSX readback. Native Gnumeric preserves the final-row name and recalculates both BIFF7/8 controls to 42, matching the repaired reader. One native XML recheck exceeded 20 seconds; subsequent bounded native CSV checks completed cleanly in 1.30/0.61 seconds. A CLI screenshot was inspected; temporary fixtures and captures were purged. Wider version/token semantics remain open.

BIFF8 SUPBOOK's one-character NUL path now binds to the current workbook, matching authenticated Gnumeric source and execution. Compressed and UTF-16 cell/range/NameX cases reproduced 18 failures; all 29 new tests and 858 neighboring BIFF tests pass, along with package lint/build. Native and compiled SDK/Shell controls return 42/42/24 and preserve those results through XML/XLSX readback without external callbacks. XLSX still warns about 34 raw records in each control; broader record preservation remains open. Malformed markers, deleted endpoints and invalid sheet indexes retain bounded failures or unbound references.

BIFF literal arrays now import numbers, strings, booleans, errors and blanks, including CONTINUE strings, named expressions and formula groups. Original BIFF7/8 string payloads reproduced six type-loss failures; explicit `arrayStringLiterals` semantics preserve stored strings through calculation, rewriting and BIFF reexport without changing Gnumeric text-entry coercion. XML/XLSX use the ignorable `urn:poe-code:ssconvert:formulas:1` annotation for SDK readback. Forty-five focused importer tests cover types, shared records, malformed payloads, namespace admission, budgets and cancellation. Four low-budget failures reproduced cumulative formula text/work amplification; import now charges retained expressions and repeated array translation across cells and groups. All 933 BIFF tests pass after the budget repair. Package lint/build and 406 files / 23,515 tests passed before the final shared-record test, which passes separately. Native BIFF7/8 and compiled SDK/Shell controls agree on TYPE=2/2/2, SUM=10 and COUNTBLANK=1; SDK/Shell XML/XLSX replay passes. XLSX still reports 18/19 raw-record loss warnings for these controls. Native XML replay coerces typed strings and rejects some serialized blank arrays, so the annotation and blank text support are extensions, not native parser parity. Other export formats, wider token/version combinations and native application readback remain open. BIFF cached memory-area payloads now advance the same auxiliary cursor as literal arrays. Six failures reproduced missing order, truncation and work admission; 13 focused controls cover token classes, CONTINUE boundaries, repeated payloads and cancellation. The 942-test BIFF run passed before the last four controls, which pass separately. MS-XLS 2.5.198.61 and SheetJS 0.20.3 confirm the layout; compiled SDK/Shell CSV, XML, XLSX and BIFF replay return 43. Native Gnumeric misreads the original payload as 42 with warnings, but reads the repaired reexport as 43 without warnings. The CLI output screenshot was inspected. This is a format-correctness extension, not native parser parity. A follow-up BIFF7 fixture exposed a version-width error: cached ranges before BIFF8 occupy six bytes, not eight. Five failing controls cover ordering, CONTINUE and work accounting; all 951 BIFF tests pass after using the format-specific width. LibreOffice `ExcelToSc::ReadExtensionMemArea` at revision `eb239f1a15f3bd8481ee5c5cf72bdb52c347efae` independently confirms the six/eight-byte distinction (`excform.cxx` SHA-256 `f7af56d4e2e9bb0c53698a72ac7da85adba8aef14a9b834d740140101fc0accf`). Package lint and the selected build pass. All 80 compiled SDK/Shell format controls replay as 43/20/22; the screenshot was inspected. Native Gnumeric returns 42 from the minimal original records with structural/formula warnings, so that is not a parity pass. Both complete BIFF7/8 reexports return 43/20/22 in native Gnumeric with empty stderr. Integrated delivery checks remain pending.

BIFF8 `PtgName` and `PtgNameX` now preserve their full four-byte indexes; index 65,537 no longer aliases index 1. Legacy writers refuse indexes their format cannot represent. Nineteen regressions cover token classes, local/external names, relocation, add-ins and original workbook recalculation. Sixteen compiled SDK/Shell BIFF7/8, XML and XLSX replay cases pass; native Gnumeric reads both BIFF reexports as 42 for the low-index control and `#REF!` for the missing high index, with empty stderr. The CLI screenshot was inspected. This native evidence covers reexports, not the original high-index record. External-workbook export identities remain the next validated BIFF gap.

WK3 op7/op8 now recognize external variables (`<<book>>Sheet:A1` and two-sheet ranges) after defined-name lookup, preserving relative axes, decoded workbook/sheet identities and correct multi-letter A1 columns. Malformed or unqualified names keep the existing diagnostic. Import performs no external access; recalculation uses the explicit host binding. The full ssconvert suite passed 403 files / 23,430 tests; 24 compiled public SDK/Shell combinations passed XML/XLSX conversion, readback and recalculation with and without a host. A CLI screenshot was inspected and removed. Authenticated libwps 0.4.14-2 supplies the syntax reference. Native Gnumeric 1.12.61 accepts a constant control but misparses this named token after reporting unimplemented named ranges, so this is an extension rather than native parity. Dynamic/relative-sheet identity, wider Lotus profiles and independent application readback remain open.

Source-led follow-up: LibreOffice `LotusToSc::ReadSRD` and libwps 0.4.14
`LotusSpreadsheet::readCell` both read flags at each modern reference token and
assign bit 0 to column relativity and bit 1 to row relativity. Our inherited
Gnumeric behavior swapped these axes and reused the first token's flag byte.
Three focused assertions reproduced the error; the decoder correction passes
all 151 tests in ten Lotus suites. Source URLs and hashes are recorded under
`reference.lotusReferenceFlags` in the gap ledger. This repairs imported formula
copy semantics. Compiled SDK import and command XLSX export/readback both retain
`=($C$2+D3)` with empty stderr; the output is 4,056 bytes. This does not establish
native application readback.

LibreOffice's `ScanVersion` binds BOF `0x0404` and `0x0406` to distinct legacy
decoders: signed eight-bit column offsets, signed eleven/thirteen-bit row
offsets, and eleven/fourteen-bit absolute rows. The importer now follows those
two profiles; seven failing assertions reproduced invalid backward references,
wrong sign boundaries and truncated absolute rows. All 163 tests in eleven Lotus
suites pass, plus package lint/types and the selected build. Compiled SDK import
and public command XLSX export/readback preserve `=A1` and recalculate it to 42
for both profiles, with empty stderr and 4,074-byte outputs. See
`reference.lotusLegacyReferenceOffsets` for pinned source evidence.

Continue investigating BOF `0x0405`, Lotus Works and sheet-relative references
from original format records. LibreOffice does not admit `0x0405` in this
dispatch; libwps documents uncertainty about older row widths and SheetJS uses
a different fourteen-bit rule. Those profiles retain their prior decoding.
LibreOffice shifts modern range endpoint flags by three bits, whereas libwps
shifts by four. Independent application qualification remains open; source
agreement on one record profile does not settle the others.

The BIFF token audit in `reference.biffCompactFormulaTokens` traces LibreOffice
legacy and BIFF8 importers. BIFF2 now uses compact NAME, ATTR/CHOOSE, ARRAY and
reference-cache payloads; MemAreaN/MemNoMemN import as reference-subexpression
metadata. Only MemArea consumes cached-range auxiliary data. Forty-six of 104
focused cases failed before correction, including a silently discarded SUM. All
104 pass, and an original BIFF2 name/cache/array workbook recalculates to 43 after
BIFF7/8 reexport. The published Excel File Format 1.42 sections 3.4, 3.9.1 and
3.9.12-13 confirm these layouts; the former ten-byte BIFF2 NAME test followed
Gnumeric’s incorrect shared pre-BIFF5 width and is corrected. The 1,413-test
cohort, final package lint/types, selected build and five compiled SDK/command
conversions pass; actual command output was visually inspected. Native application
and remaining token qualification stay open.

The versioned function audit in `reference.biffVersionedFunctionArity` identifies
six old fixed-argument forms rejected by the modern function table: FIXED, TRUNC,
WEEKDAY, HLOOKUP, VLOOKUP and DAYS360. Their version-specific counts now import.
The baseline failed 59 of 82 cases; all pass after correction, with 1,795 surrounding
tests, maintained lint/types and the selected build passing. Twelve compiled
SDK/command BIFF2/3/4-to-BIFF7/8 conversions retain all 56 expected values without
diagnostics. Native application and broader BIFF qualification remain open.

The ARRAY record audit in `reference.biffCompactArrayRecord` confirms that BIFF2
uses an eight-byte header, distinct from later versions. Correcting its token
offset and one-byte length restores numeric and string array formula groups.
Two of fourteen original regressions failed; all now pass, alongside 1,501 BIFF
tests, maintained lint/types, selected build and 24 compiled SDK/command
conversions retaining 48 values without diagnostics. Native qualification remains open.

The Calc reference-model audit is recorded under `reference.sheetReferenceSemantics`.
Its parser and writer preserve ODF sheet `$` markers; external sheet references
are absolute. Moves resolve the old target and rebind at the new formula position.
The candidate's cross-sheet origin move now qualifies implicit local references,
including both range endpoints, while retaining original display names and applying
simultaneous renames. All seven baseline failures and 109 neighboring checks pass.

The shared model now retains per-endpoint sheet relativity in standard `of:=`
formula strings, including names and array groups. ODF preserves sheet `$`
markers; XML/XLSX carry the source and named anchor in the existing ssconvert
namespace beside a fixed-target fallback. Readers ignoring those annotations
lose relative-sheet copy semantics. BIFF7/8 export resolves relative targets at the formula or name declaration
anchor, with a warning for the lost relative-sheet behavior. Recalculation resolves named expressions from their declaration anchor;
SDK copy translation follows workbook tab order, while moves retain target identity.
CLI `--set` and SDK text updates accept OpenFormula.

Eight initial regression cases failed, with additional failing controls for
out-of-workbook copy, text updates, unsupported target grammars and explicit
fixed-sheet conversion. All 440 package files / 24,426 tests passed before the
last two serializer guards; the final 42-test formula/codec/legacy cohort,
maintained package lint/types and selected build pass. Six compiled SDK/command
XML/XLSX/ODF conversions retain the mixed sheet flags after readback and calculate
23 after copying to the next sheet. A screenshot of the compiled public command
with explicit memory I/O confirms `--set B1=of:=[.A1]+1` emits `11,12`.
These checks establish candidate behavior,
not native-application qualification.

Modern Lotus direct references now retain bit 2 as sheet relativity and force
owner-sheet endpoints relative, following pinned LibreOffice `ReadSRD`. Relative
references survive the decoder's expression construction as reference nodes and
are stored as OpenFormula; fixed-only expressions retain their native syntax.
Repeated physical targets keep independent flags, and quoted/backslash string
literals survive both grammars. Five of six initial sheet controls failed, as did
two subsequent literal controls. Existing three-sheet sums still return 41;
the affected expectations now retain their owner-sheet flag in OpenFormula.
The second range endpoint still uses the existing three-bit shift; this does not
resolve libwps's conflicting four-bit layout. All 441 package files / 24,436 tests,
maintained lint/source/test/consumer types and selected build pass. Six compiled
SDK/command XML/XLSX/ODF conversions preserve the literal and calculate 23 after
readback and copying; input is 158 bytes, outputs are 735/5940/3410 bytes.
Qualify origin moves separately from moved cell ranges, tab reordering and copying:
Calc's optional `AdjustCrossSheetRefs` clone mode preserves nonzero cross-sheet
targets even when the underlying token is relative. Native operation qualification,
BIFF persistence, deleted-sheet behavior and the Lotus endpoint-bit disagreement
remain open.
The named-range audit in `reference.lotusReferenceFlags.namedReferenceSourceReview`
traces LibreOffice Userrange through Add/FindRel/FindAbs. The absolute-name path
sets relative sheet flags, while its declaration starts from physical coordinates;
the shown private token/index construction alone does not establish document-name
installation or a working native copy result. Keep the existing libwps-derived
expansion until independent native-authored evidence resolves this discrepancy.

The BIFF exporter audit now records pinned LibreOffice `xeformula.cxx` under
`reference.sheetReferenceSemantics.biffExportSource`. Its cell/range exporter
resolves relative sheets at the base position and writes fixed EXTERNSHEET links;
row/column relativity is encoded separately. A missing base position can instead
produce an invalid tab. BIFF7/8 now exports fixed targets and reports one
`biff-loss-warning` per affected formula or name. Implicit first-sheet range
endpoints bind to the actual source sheet. Six initial regressions failed; ten
focused cases and all 1,309 checks in the 58-file BIFF/relative-sheet cohort pass.
Named-expression readback deliberately changes a caller-relative result from 10
to the declared target 11, with a warning. This does not preserve relative-sheet
copy semantics or establish lossless relative named-expression roundtrips.
Maintained lint/source/test/consumer types and selected build pass. Four compiled
SDK/command BIFF7/8 exports reopen as 33/11 with two warnings and 4096-byte
outputs; actual command screenshot inspected. Native readback remains open.


LibreOffice's separate WK3/WK4 reader also exposed a missing BOF version:
`0x1000`, subtype 4, with a 26-byte header. The importer now detects that WK3
profile and decodes its cell/name references and two-byte numeric formula
tokens through the modern path. Four original admission/decoding assertions
failed before correction; all 167 Lotus checks now pass, with package
lint/types and the selected build. A 133-byte in-memory fixture converts through
the compiled public command to XLSX and reopens with values 7/8/8, both formulas
`=(A1+1)`, empty stderr and a 4,087-byte output. Pinned source evidence is in
`reference.lotusWk3Admission`. Wider WK3 formatting, charset/companion records,
relative sheets and independent application qualification remain open.

The function audit now uses LibreOffice's actual import transformations rather
than assuming Gnumeric's declared handlers implement them. Lotus `YEAR` returns
years since 1900; Gnumeric's `wk1_year_func` only documents that subtraction and
delegates unchanged. The importer now applies it for direct and named Lotus
functions. Four original regressions fail before the change; all 171 Lotus
checks, package lint/types and the selected build pass. Compiled command XLSX
readback retains the subtraction and returns 124 for a date in 2024. Other
argument/index conversions and Works qualification remain open. See
`reference.lotusYearSemantics` for the source and readback evidence.

LibreOffice's `DoFunc` also establishes zero-based Lotus positions for `CHOOSE`,
`MID`, `REPLACE` and `FIND`, a zero-based `FIND` result, and ungrouped `STRING`
formatting. The importer now translates these conventions after resolving direct
or named functions. Fifteen original regressions failed before the correction;
all 186 checks in thirteen Lotus files, package lint/types and the selected build
pass. Compiled command XLSX export and SDK readback preserve all five formulas
and results across legacy direct, original WK3 direct and modern named profiles,
with empty stderr and 4,205–4,219-byte outputs. See
`reference.lotusPositionSemantics`. Lookup/INDEX, financial conversions, Works
semantics and independent application qualification remain open.

The financial audit applies LibreOffice's `RATE`, `TERM` and `CTERM` operand
conversions and Gnumeric's implemented `PMT`/`PV`/`FV`/`IRR` rewrites after named
function resolution. Twelve original assertions failed before correction; all
206 Lotus checks, package lint/types and the selected build pass. Compiled
command XLSX export and SDK readback preserve six financial formulas and values
across three profiles (18 observations, error below 1e-12), with empty stderr and
4,157–4,171-byte outputs. Direct/named IRR range order also passes. The source
audit also identified unsigned compact-number formula decoding; ordinary compact
cell records already sign-extended. The formula decoder now uses the same signed
16-bit value, matching LibreOffice's `FT_Snum` and `SnumToDouble` implementations.
Twenty original assertions failed; all 230 Lotus checks pass, including eight
scaling factors, signed limits and matching literal cell records in both WK3
profiles. See `reference.lotusCompactSignedNumbers` for the source evidence.
Package lint/types/build pass; compiled command XLSX export and SDK readback
preserve -1, -5000 and -0.015625 in both profiles, with empty stderr and 4,086-byte
outputs from 100-byte inputs. Fixtures remain in memory.
See `reference.lotusFinancialSemantics`. No compatibility family is closed.

Three-argument `INDEX`, `HLOOKUP` and `VLOOKUP` now translate Lotus's zero-based
indices; `INDEX` also swaps its column/row operands. Nine original regressions
failed; all 239 Lotus checks, package lint/types/build and compiled command
XLSX/SDK readback pass. Three profiles preserve results 10/20/20 and translated
formulas with empty stderr and 4,147–4,159-byte outputs. See
`reference.lotusLookupSemantics`. Other arities, dynamic/relative-sheet identity, range flag
packing and independent application qualification remain open.

The 23 missing aliases from LibreOffice's `lcl_KnownAddIn` now resolve, covering
all 47 names recognized by that source table. These are named-only additions;
ROUNDUP/ROUNDDOWN also discard the optional third operand. All 23 original
regressions failed; all 262 Lotus checks and package lint/types/build pass.
Compiled command XLSX and SDK readback retain the 23 scalar/range/statistical
results within 1e-12, with empty stderr and a 4,588-byte output from 1,229 bytes.
See `reference.lotusNamedAddinAudit`. Wider domains, vendor add-ins, Works and
independent application qualification remain open; this is name-table coverage,
not full native compatibility.

Source review also found incorrect numeric widths in modern formula records.
LibreOffice's `OP_Formula123` and libwps select 8-byte floating/32-bit compact
constants for record `0x28`, versus 10-byte floating/16-bit compact constants for
record `0x19`. The decoder now retains that record layout during deferred formula
resolution instead of inferring it from BOF. Seven original regressions failed;
all 270 Lotus checks, package lint/types and selected build pass. Compiled command
XLSX export and SDK readback preserve both layouts in four BOF profiles, with
empty stderr and 4,067-byte outputs from 100-byte in-memory inputs. See
`reference.lotusFormulaNumericLayouts`. Numeric extremes and independent
application qualification remain open.

The extended-number decoder now preserves small binary64 values and rounds the
original 64-bit significand once. libwps's normalized `readDouble10` scaling
exposed premature underflow in the prior expression. Six original regressions
failed; all 279 Lotus tests and package lint/types/build pass. CPython 3.14.7
exact-rational conversion independently qualifies nine boundary inputs; compiled
command XLSX export and SDK readback match all 18 literal/formula results
bit-for-bit. The 466-byte input and 4,237-byte output stay in memory. See
`reference.lotusExtendedRounding`; other encodings and application qualification
remain open.

LMBCS Unicode compatibility decoding now handles the `F6 xx` zero-byte escape
and preserves private-use code units. Five source-derived regressions failed;
all 285 Lotus tests and package lint/types/build pass. Native ICU 78.1 confirms
six byte sequences, and compiled command XLSX/SDK readback retains all twelve
label/formula strings. The 286-byte input and 4,539-byte output remain in memory.
See `reference.lotusUnicodeCompatibility`; other national/exception groups and
native workbook application qualification remain open.

LMBCS groups `0x10`–`0x13` now share the existing Windows 932/949/950/936 tables
using ICU's explicit/implicit and repeated-prefix rules. Four regressions failed;
the Traditional Chinese control already passed. All 290 Lotus tests and package
lint/types/build pass. Native ICU and compiled XLSX/SDK readback agree on five
mixed strings (ten label/formula observations), including halfwidth Katakana.
No new mapping assets were added. See `reference.lotusNationalDoubleByteGroups`;
wider mapping, malformed-sequence and workbook application qualification remain
open.

Control-group decoding now retains C0/C1 values and the literal `0x19` marker
without consuming its following character. Four regressions failed; all 296
Lotus tests and package lint/types/build pass. Native ICU confirms six sequences;
compiled SDK import/recalculation preserves twelve strings. Export qualification
found separate limitations: BIFF/CSV truncate embedded NUL, and XLSX refuses
non-XML characters without publishing output. Investigate the exporters' source
contracts and XLSX escaping next; these are not successful roundtrips. See
`reference.lotusControlCharacters`. No family is closed.

LibreOffice's serializer, attribute decoder and rich-string importer establish
the XLSX `_xHHHH_` contract. Shared/inline strings now escape invalid XML units,
protect literal and overlapping escape text, and decode once before computing
UTF-8 rich-run offsets. All 221 XLSX tests pass, including nineteen focused
source-derived cases. Next inspect formula-cache and other ST_Xstring fields,
then BIFF/CSV NUL handling; retain separate native application qualification.
See `reference.xlsxCellStringEscapes` for pinned source hashes and remaining scope.

LibreOffice's BIFF string buffers use explicit lengths and preserve NUL. The
two candidate truncations are removed; all 1291 BIFF checks pass. Compiled SDK
and recalculating command paths preserve eighteen BIFF7/8/DSF observations.
Independent xlrd confirms seventeen; its long BIFF7 LABEL read stops at the
first record. Deeper LibreOffice source inspection also finds first-record/NUL
truncation in its legacy reader and NUL substitution in its Unicode reader;
the length-preserving writer does not establish native roundtrip fidelity.
Keep those interoperability gaps and the BIFF7 metadata warnings
open. XLSX still refuses raw-NUL formula expressions without publishing output.
CSV import/export have separate lossy NUL policies; inspect both before changing
either. See `reference.biffNulStrings`; no family is closed.

Lotus range source review: LibreOffice and Gnumeric shift second-endpoint flags
by three bits; libwps uses four. Keep the current three-bit layout pending primary
format or native-authored evidence. LibreOffice also retains sheet relativity,
which the candidate discards. Extend the shared formula reference model first:
it currently stores only sheet names and also discards ODF absolute-sheet markers.
Then preserve the distinction through import, relocation and export. A Lotus-only
decoder change would lose it downstream. See `reference.lotusReferenceFlags`;
native application qualification remains open.

CSV source follow-up: LibreOffice's actual import calls EmbeddedNullTreatment
before field parsing and removes every NUL. Its length-aware exporter does not
prove lossless roundtrips. The candidate now preserves NUL through text import
and both CSV exporters, with the native difference documented. Twelve initial
regressions failed; all 169 text-codec checks pass. Eight compiled SDK/command
conversions and independent Python CSV readback preserve 72 values exactly.
All 437 package files / 24,384 tests, lint/types and the selected build pass;
publication remains pending. See `reference.csvNulSourceReview` for source hashes
and scoped evidence. No family is closed.

The full package gate exposed retained XML recursion before resource admission.
The writer now traverses iteratively, checks limits before descending, rejects
cycles and permits shared children. Two baseline controls failed; all 24,384
package tests pass after repair, with lint/types and the selected build. Three
quota tests now explicitly select finite limits after the default changed to
unlimited; the annotation fixture no longer creates 100 million spaces. Monitor
containing publication before marking release restoration complete.
See `reference.gnumericRetainedTraversal`.

LibreOffice's formula-cache path is now traced separately: ordinary string
results use `t="str"`; its inline-string branch handles invalid/default results.
The loader interns raw cached text only for known-good generators and requests
recalculation for line breaks. This does not establish the shared-string escape
contract for formulas or their caches. Preserve that distinction and the open
NUL gaps; see `reference.xlsxCellStringEscapes.formulaCacheSource`.

Windows Works v3 references now use the signed column/row widths and target
wrapping identified in libwps. Six regressions failed before correction; all
303 Lotus checks pass, including the WK1/WK2 controls. Public recalculating
WKS-to-XLSX conversion preserves backward references and larger absolute rows.
BOF 0x0405 is Symphony in the source, so it remains separate from this Windows
Works repair; its separate decoder is now recorded below. Native application
and ambiguous DOS Works qualification remain open; see
`reference.lotusWorksWindowsReferences`.

DOS Symphony BOF 0x0405 now follows libwps's conditional low-byte column wrap
and signed 14-bit row offsets. Ten initial failures reproduced the generic
fallback defect; all 317 Lotus checks, maintained package lint/types and selected
build pass. Nine compiled public recalculating XLSX conversions preserve formulas
and values with no diagnostics, including four backward references returning 42.
Absolute coordinates remain intact; a target beyond the imported sheet's 256
columns correctly evaluates to #REF!. Native application qualification and
ambiguous DOS Works profiles stay open; see `reference.lotusSymphonyReferences`.
No family is closed.

Direct Lotus ranges now retain both physical sheet endpoints when one endpoint
is the formula's own sheet. Gnumeric and LibreOffice source establish the
independent sheet identities. Four regressions previously summed only 11 or 17
instead of 41; all 327 Lotus checks, lint/types and selected build pass. Ten
compiled public XLSX conversions preserve sheet names and values through fresh
recalculation. Relative-sheet flags and independent native readback remain open;
see `reference.lotusDirectSheetSpans`.

Lotus error-constant token width remains a source disagreement: LibreOffice
skips ten payload bytes, while Gnumeric consumes eleven. The candidate follows
Gnumeric. Obtain primary format or native-authored evidence before changing the
width; see `reference.lotusErrorConstantWidth`.

Native format qualification uses the authenticated Gnumeric 1.12.61 source with GLib 2.90.0, goffice 0.10.62, GTK 3.24.52 and libgsf 1.14.59 on macOS arm64; it is distinct from the Linux numeric profile. Source-derived GSettings schemas correct a failed Homebrew library-discovery probe without modifying native source. A disposable public-API driver supplies test passwords through stdin, recalculates both sheets and saves Gnumeric XML. Three plaintext controls, 12 XOR exports (BIFF7/8 and DSF primary streams; 1/8/14/15-byte passwords) and four standard-RC4 exports (empty, ASCII, Unicode and 15 UTF-16 units) preserve all expected cells, including 10,800/16,200-character strings, formulas, booleans and errors. Both formulas recalculate to 42; 13 applicable wrong-password controls refuse with no output. Gnumeric refuses all 12 CryptoAPI profiles and the tested standard-RC4 lengths 16/27/28/31/32/255; its source's one-byte password-bit-length field explains the 15/16 boundary. These native limits do not narrow product support. The ledger binds executable/library/driver hashes and the 37-input aggregate (sorted basename, NUL, binary SHA-256 digest). Other native applications, platforms, ancillary streams and optional-language profiles remain open.

LibreOffice source investigation now takes priority over expanding application matrices. At native build `bce0998afefdbc355585ca324285661a2170ba77`, Calc admits only 1–15 UTF-16 password units and initializes CryptoAPI with a fixed 128-bit key. This explains the existing capture: six of 35 BIFF8 exports open (plaintext, three standard-RC4, two CryptoAPI), preserving 168 observed cells across load/recalculation. Source also explains native XLSX error loss: BIFF literal errors become `ocStop`, which the OOXML symbol table spells `#REF!`, while the separate cache remains `#DIV/0!`. BIFF export explicitly preserves the error token. All 24 SDK/Shell sheet replays match the recorded semantics; retaining the stale XLSX cache would be incorrect. The 34 wrong-password refusals used 25-unit passwords, so they do not qualify verification within Calc's admitted range. Captures predate subsequent resource-limit/Shell changes; current-head, native reexport reopening and screenshot qualification remain open. See `../ssconvert/biff-libreoffice-interop-proof.json` and `ssconvert-encrypted-biff-application-qa.md`. No family is closed.

Packed public consumers were qualified at `51af29f33` outside the repository with no private ssconvert package resolution. The root SDK and scoped Shell pass all 80 BIFF7/8 format/replay controls; strict NodeNext declarations, logical PWD, typed-array XLSX-to-CSV, edited CSV-to-XLSX, cancellation and input-budget controls also pass with native-command PATH empty. Canonical scoped packaging initially failed on four orphaned Tesseract build files whose sources/manifests no longer exist; removing those ignored outputs restored packaging without a source change. Tarball SHA-256 bindings: `poe-code` `1a5bfcfad4a5c9b8e5308b1c81524b483d5aea3f25e6d79c2c9dd178f8405bb9`; `@poe-platform/safe-fs` `7b43bc977e653c323ff615a798f4429e4f00c3536d8f6e22b65c773b75e8cd55`; `@poe-platform/safe-bash` `e1f77240b40f048e56c9409f61952b821f49d2b04ebdf768fab30b747ab998f0`. Installed consumers, staged packages and tarballs are disposable; registry-installed and wider browser/worker/service qualification remains open.

Bessel phase dispatch now extends through `2^52`, the argument boundary beyond
which Gnumeric warns about reduced reduction accuracy. Fifteen initial failures
reproduced the prior `1e12` cutoff. The zero first-term case now terminates its
identically zero recurrence, preserving finite work limits. All 175 focused
checks, lint/types and selected build pass; 64 compiled public conversions and
fresh recalculations match unchanged C source components linked to goffice
0.10.62 on Darwin. Seven XLSX metadata-loss warnings remain open. This is
component/source qualification, not full native or correctly rounded coverage;
see `reference.besselPhaseBoundary`. The 120 retained high-q cases already match
current code; do not present their historical 47 failures as current.

Current priorities:

1. Continue encrypted-format qualification, including broader ODF application profiles and remaining BIFF/Paradox profiles; keep the encryption families open until their full requirements pass.
2. Complete integrated verification and delivery. The full build at a3c650383 passes. Safe Bash typechecking then exposed optional codec-bridge arguments recorded as number-only arrays; the test recorder now preserves optional undefined arguments, and all eight runtime controls pass. Rerun maintained types/consumers, root lint and full npm test on the committed batch, then verify remote main and containing publication. The earlier diagnostic-interrupted full test run remains incomplete.
3. Continue the remaining ledger families and qualify the resulting packed SDK/Shell artifacts.

Paradox encrypted export now accepts explicit `encryption=paradox` and a host-supplied 1–256-byte password, with native NUL termination, preflight budgets, cancellation and owned-buffer cleanup. Plaintext remains default; empty effective passwords are refused. This legacy format leaves a recoverable key and readable schema. All 34 new regressions and the 113-test focused cohort pass against independent pxlib vectors. Seven actual compiled SDK profiles and a compiled Shell export reopen in native Gnumeric byte-exact across 145 rows and two physical blocks, with empty stderr; absent/invalid/throwing-password and preflight controls preserve destinations. The command diagnostic screenshot was inspected. The ledger binds source and native provenance; disposable table fixtures and captures are purged after use. Wider Paradox profiles, companions and integrated delivery remain open.

Verified remote main through da7a6f2b3 includes XOR/RC4/CryptoAPI export, exact CFB stream lengths, cleanup and modern ODF import/export. Published poe-code@17.0.35 points to a8a8a7ef and predates these changes; containing publication remains pending.

Historical run journals and disposable evidence were removed at the user's request. Required test fixtures, canonical inputs and source provenance remain. Prior captures can be inspected in Git history when needed; they are not current-candidate proof. Do not recreate bulky progress journals or commit raw command output.

BIFF8 external imports now preserve decoded workbook paths, sheet references and global/sheet-scoped names. Thirty-four new regressions cover original records, token classes, path encodings, Unicode/quotes, malformed names and paths, budgets, cancellation and explicit host resolution. External namespaces cannot borrow local-name values or evaluate their stored EXTERNNAME definitions. Eight compiled public SDK XML/XLSX replay cases retain identities; XML does not retain cached values. This is an extension beyond Gnumeric’s external-link behavior. BIFF7 import, BIFF export, detached sheets and native/application/Shell qualification remain open; no family is closed.

The BIFF8 import change passes all 410 ssconvert files / 23,625 tests and the two required posttest checks, package lint/types and the selected four-workspace build. The compiled scoped Shell returns `#REF!` without a host and `84` with one explicit host call, with empty stderr; the command screenshot was inspected. Wider command and native/application qualification remains open.

BIFF8 export now emits external workbook/name tables for cells, ranges, scoped names, defined expressions and array formulas. Eighteen writer controls cover identity, local/add-in/macro namespace separation, discovery order and format limits. Four compiled SDK profiles and eight scoped Shell roundtrips recalculate all seven controls to 42 with six explicit host calls; no-host runs keep external expressions at `#REF!` without accessing a host. Native Gnumeric opens all four files and preserves local controls, but warns that external references are unsupported and evaluates them to `#REF!`; application qualification remains open. All 411 files / 23,643 tests and two posttest checks passed before the final warning correction; the final 1,022-test BIFF cohort, lint/types, build and SDK/Shell rechecks pass afterward. The command screenshot was inspected. Remaining token profiles and independent application interoperability remain open. BIFF7 import now preserves external cell/range and global/scoped name identities, with independent document and worksheet tables. OpenOffice format 1.42 confirms the token and scope layout; 32 record regressions, 12 compiled SDK replays and eight scoped Shell checks pass. All 412 files / 23,675 package tests plus two posttest checks pass; selected build passes. Package lint/types and the final 32-test rerun pass after a test-helper annotation correction. Independent application qualification remains pending.

BIFF7 export now writes per-document external names and sheet links in both global and worksheet tables. Six compiled SDK and 12 scoped Shell profiles pass, including long raw URL lengths and Windows-1252 identities. Unrepresentable paths, indexes and external multi-sheet ranges are refused. Native Gnumeric warns and misbinds external cells to local values; these readbacks fail interoperability qualification. All 413 files / 23,707 package tests and two required posttest checks pass, as do lint/types and the selected build. No family is closed. Missing local targets now export as deleted BIFF7/8 references rather than refusing conversion. Six compiled SDK replays and both native reexports match #REF! semantics with valid-sheet/IFERROR controls; missing sheet spellings cannot survive deleted-reference encoding. Sixteen memory regressions, lint/types and the selected build pass. All 414 files / 23,723 package tests and two posttest checks pass; both compiled Shell checks pass and the screenshot was inspected. Eight seed layout/print metadata warnings remain outside this repair.

BIFF layout follow-up: twelve initial regressions reproduced lost scroll positions and frozen panes. Native Gnumeric then exposed four single-axis scrolling failures; WINDOW2 owns the unfrozen axis and PANE owns the frozen axis. The importer reconstructs canonical freeze origins. All 51 BIFF files / 1,124 tests pass after correction; the preceding package run passed 415 files / 23,741 tests and both posttest checks. Final lint/types and selected build pass. Six native-authored BIFF imports, eight compiled SDK exports and XML replays, all eight native layout readbacks with empty stderr, and eight compiled Shell conversions preserve coordinates. The CLI screenshot was inspected. Unfrozen splits and unknown layout fields retain loss warnings; the remaining print/protection metadata warnings are still open.

BIFF fit-to-page now preserves the mode and width/height counts regardless of SHEETPR/PAGESETUP order. BIFF and XLSX exports accept native Gnumeric `size_fit` alongside the normalized `fit` spelling. Ten initial failures and six spelling failures were reproduced; all 18 focused cases and the final 61-file / 1,308-test BIFF/XLSX cohort pass. The preceding package run passed 416 files / 23,757 tests and two posttest checks. Final lint/types and the selected build pass. Eight native-authored imports, 16 compiled SDK exports through XML/XLSX, 16 clean native readbacks and eight compiled Shell exports preserve fixed/unrestricted fit dimensions and the 75% control. The CLI screenshot was inspected. This qualifies settings rather than rendered page counts; remaining metadata and rendering gaps stay open.

BIFF8 now preserves printed comment placement and error-display modes. BIFF7 writes only its supported flags and warns when it must use in-place comments or displayed errors; its importer ignores BIFF8-only bits. Twenty-three failures and two controls reproduced the defects. All 25 regressions, 92 focused tests, 417 files / 23,788 package tests and both posttest checks pass. Final lint/types and the selected build pass. Twelve native BIFF8 imports, 24 compiled SDK/native mode checks and eight Shell profiles pass; the CLI screenshot was inspected. Qualification covers stored settings, not rendered output. XLSX print headings, gridlines and centering remain a separate validated loss: Gnumeric also ignores those XLSX options, while openpyxl 3.1.5 reads the original flag fixture correctly.

XLSX print headings, gridlines and centering now survive import and export, including standalone printOptions and both XLSX editions. BIFF suppresses the raw printOptions warning only when emitted flags match every represented field. Thirty-one failures were reproduced; all 36 regressions, 71 focused tests, 418 files / 23,824 package tests, both posttest checks, lint/types and the selected build pass. Sixteen openpyxl-authored inputs and 32 SDK BIFF/XLSX replays pass independent flag readback; eight Shell controls and the screenshot pass. Gnumeric ignores those XLSX options, so its XLSX parity is not claimed; its BIFF readbacks match with empty stderr. openpyxl still warns that reexports lack a default style. Other raw metadata and rendering gaps remain open.

Both XLSX editions now declare the built-in Normal style using the existing default style XF. Two SDK regressions reproduced the omission; all 13 focused tests, 418 files / 23,824 package tests, both postchecks, lint/types and the selected build pass. Thirty-six compiled SDK exports covering both editions, every print-flag combination, empty sheets and custom formatting load in openpyxl 3.1.5 without warnings. Values, custom formats, print flags and parent-style references pass independent checks. Other named styles, metadata, rendering and application qualification remain open; no family is closed.

The Python binding now accepts explicit Unicode 15/16 selection for capitalization and printable-character formatting, retaining Unicode 16 by default. All 139 recorded Unicode 15 CAPWORDS differences reproduced before implementation. Full-domain runtime property extraction supports a compact override table; 1,048 focused checks, 419 files / 23,969 package tests, both postchecks, lint/types/public consumers and the selected build pass. Each compiled SDK/Shell profile matches 439 independent CPython cases with no diagnostics, covering 2,935 casing, 7,061 context-property and 5,905 printability code points. The CLI screenshot was inspected; its font lacks the Ahom glyph used in a context case. Exact activated optional profiles, browser/worker and installed-package requalification remain open; no family is closed.

Browser and Web Worker Unicode follow-up: build the current public ssconvert entry for a browser, then run both explicit profiles against the independent CPython corpus in the page and a module worker. Compare complete CSV output hashes with the compiled Node/Shell results. Exercise inactive bindings, invalid profile names, cancellation, output limits and worker termination. Inspect browser console/network output and a screenshot, record exact runtime/build identities, then close the owned browser/server and purge generated assets. This does not substitute for native plugin activation or registry-installed qualification.

Chrome 154.0.8037.58 page and module-worker qualification passed both Unicode profiles: 439 independent cases per profile/context, identical full CSV hashes to Node/Shell, inactive bindings, invalid versions, pre-abort identity and output/work limits with zero publication. Worker termination, zero console warnings/errors, owned local requests and the screenshot were checked. CSV re-import consumes a leading apostrophe, confirmed by four native Gnumeric controls; the initial probe expectation was corrected without a product change. Exact native optional profiles, packed/installed qualification and publication remain open.

Database value-format qualification passed native date/time selection and twelve XML/Excel exports across both epochs. The real Gnumeric 1.12.61 GDA plugin now connects to an owned SQLite DSN through its actual GTK dialog. Thirteen typed columns, repeated EXECSQL/READDBTABLE queries, empty/error results, first-dialog rejection, both epochs and connection deactivation were captured. The public SDK with an explicit live SQLite host matched 84 native scalar/error observations and four read-only policy controls; two cancellation operations published nothing and closed their connections. Native libgda mutated the owned database despite its read-only option, then returned a selection error; the candidate preserves enforced read-only access. This is supplemental Darwin application qualification, not the frozen Linux optional profile or a general database adapter. Follow `docs/plans/ssconvert-native-database-qualification.md` for the manual procedure and remaining qualification. No family is closed.

Paradox decryption now registers its owned plaintext buffer before allocation and clears it on disposal or failure, preserving borrowed input and abort identity during overlapping cancellation/cleanup. Two baseline regressions reproduced the omissions; five added lifecycle controls and the final 85-test Paradox/database cohort pass. The preceding maintained ssconvert package suite, both root postchecks, final lint/types/public consumer checks and selected build pass. Six compiled SDK/command fixtures retain native-qualified CSV values and existing v4 encoding warnings. Physical block 65,535 now matches the retained pxlib oracle at its actual position, alongside all five neighboring vectors, using 67,107,840 in-memory bytes with finite limits; no large fixture was written. Implementation is verified on remote main at `73265db985`; publication remains pending. The Safe Bash build now passes after correcting Pandoc dependency admission for upstream DOCX/XLSX conversion (hey-boss #2568); all 417 build tests and scoped lint pass. The rebuilt compiled Shell passes the six Paradox fixtures and preserves input and existing destination on a post-decryption cell-limit failure. Wider encryption profiles, companions, application qualification and all nineteen families remain open.
