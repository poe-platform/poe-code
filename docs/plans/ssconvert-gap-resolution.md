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

WK3 op7/op8 now recognize external variables (`<<book>>Sheet:A1` and two-sheet ranges) after defined-name lookup, preserving relative axes, decoded workbook/sheet identities and correct multi-letter A1 columns. Malformed or unqualified names keep the existing diagnostic. Import performs no external access; recalculation uses the explicit host binding. The full ssconvert suite passed 403 files / 23,430 tests; 24 compiled public SDK/Shell combinations passed XML/XLSX conversion, readback and recalculation with and without a host. A CLI screenshot was inspected and removed. Authenticated libwps 0.4.14-2 supplies the syntax reference. Native Gnumeric 1.12.61 accepts a constant control but misparses this named token after reporting unimplemented named ranges, so this is an extension rather than native parity. Dynamic/relative-sheet identity, wider Lotus profiles and independent application readback remain open.

Native format qualification uses the authenticated Gnumeric 1.12.61 source with GLib 2.90.0, goffice 0.10.62, GTK 3.24.52 and libgsf 1.14.59 on macOS arm64; it is distinct from the Linux numeric profile. Source-derived GSettings schemas correct a failed Homebrew library-discovery probe without modifying native source. A disposable public-API driver supplies test passwords through stdin, recalculates both sheets and saves Gnumeric XML. Three plaintext controls, 12 XOR exports (BIFF7/8 and DSF primary streams; 1/8/14/15-byte passwords) and four standard-RC4 exports (empty, ASCII, Unicode and 15 UTF-16 units) preserve all expected cells, including 10,800/16,200-character strings, formulas, booleans and errors. Both formulas recalculate to 42; 13 applicable wrong-password controls refuse with no output. Gnumeric refuses all 12 CryptoAPI profiles and the tested standard-RC4 lengths 16/27/28/31/32/255; its source's one-byte password-bit-length field explains the 15/16 boundary. These native limits do not narrow product support. The ledger binds executable/library/driver hashes and the 37-input aggregate (sorted basename, NUL, binary SHA-256 digest). Other native applications, platforms, ancillary streams and optional-language profiles remain open.

Packed public consumers were qualified at `51af29f33` outside the repository with no private ssconvert package resolution. The root SDK and scoped Shell pass all 80 BIFF7/8 format/replay controls; strict NodeNext declarations, logical PWD, typed-array XLSX-to-CSV, edited CSV-to-XLSX, cancellation and input-budget controls also pass with native-command PATH empty. Canonical scoped packaging initially failed on four orphaned Tesseract build files whose sources/manifests no longer exist; removing those ignored outputs restored packaging without a source change. Tarball SHA-256 bindings: `poe-code` `1a5bfcfad4a5c9b8e5308b1c81524b483d5aea3f25e6d79c2c9dd178f8405bb9`; `@poe-platform/safe-fs` `7b43bc977e653c323ff615a798f4429e4f00c3536d8f6e22b65c773b75e8cd55`; `@poe-platform/safe-bash` `e1f77240b40f048e56c9409f61952b821f49d2b04ebdf768fab30b747ab998f0`. Installed consumers, staged packages and tarballs are disposable; registry-installed and wider browser/worker/service qualification remains open.

Current priorities:

1. Continue encrypted-format qualification, including broader ODF application profiles and remaining BIFF/Paradox profiles; keep the encryption families open until their full requirements pass.
2. Complete logical-PWD delivery and containing release CI. At `89987de43`, the full build, root lint (zero errors, 19 warnings, no gaps), Safe Bash types and all 26 maintained consumer groups pass. Thirty-two compiled public SDK/Shell controls cover grep, logical PWD and BIFF7/8 with native-command PATH empty. The full test run stopped in its first shared batch: 1,855 tests passed and two browser-fixture tests failed because they omitted the portable network API's required finite limits. Explicit fixture limits restore all 44 bundle tests; the product requirement is unchanged. The older release also timed out in the unchanged DOCX model-depth suite. It passes locally, but its identical-byte assertion costs 1.23 seconds for 917,664 bytes. Exact byte comparison preserves equal/changed-byte outcomes and both depth cases; all 26 neighboring depth tests pass. The subsequent full run at 7e2c8879e was deliberately stopped incomplete after another CI failure reproduced locally: a clock tick could cancel a SafeJS timeout diagnostic before stderr received it. Starting the diagnostic write before checking its remaining deadline fixes the deterministic regression; all 52 neighboring command/lifecycle tests pass with unchanged runtime and test timeouts, and the visible Node diagnostic was screenshot-inspected. Rebase, integrated repeat and containing publication remain pending. The grep repair retains 157 focused tests and 78 independent probes, unchanged historical captures, and GNU grep 3.12's early matcher-conflict rule.
3. Continue the remaining ledger families and qualify the resulting packed SDK/Shell artifacts.

Paradox encrypted export is the next validated encryption gap: the public command rejects `encryption=paradox` before password acquisition or output. The pinned pxlib 0.6.8 cipher source from the existing encryption proof produced 36 independent checksum/block vectors across six password profiles and six physical block numbers, including byte and wrap boundaries. This is reference evidence, not an implemented exporter. The initial retained macOS Gnumeric build refused a plaintext control because its Paradox plugin was absent; that attempt remains unavailable evidence. Building the original plugin against pxlib 0.6.8 with libgsf enables actual native reading. Six canonical encrypted fixtures preserve their expected values, including the two original v4 encoding warnings. Six current public-writer/pxlib controls preserve all 145 rows across two physical blocks byte-exactly with empty stderr, covering plaintext and five password profiles. The ledger binds native source/library/module hashes and the private configuration shim; upstream callback-type warnings remain documented. Product encrypted export is still unimplemented. Temporary compiler trees, table fixtures and completed array artifacts were purged; the compact native installation remains available for the exporter qualification.

Verified remote main through da7a6f2b3 includes XOR/RC4/CryptoAPI export, exact CFB stream lengths, cleanup and modern ODF import/export. Published poe-code@17.0.35 points to a8a8a7ef and predates these changes; containing publication remains pending.

Historical run journals and disposable evidence were removed at the user's request. Required test fixtures, canonical inputs and source provenance remain. Prior captures can be inspected in Git history when needed; they are not current-candidate proof. Do not recreate bulky progress journals or commit raw command output.
