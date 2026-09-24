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

Current implementation: LibreOffice Argon2id v19/AES256-GCM encrypted-package import is implemented with cumulative ZIP/XML/work limits, a default 64 MiB Argon2 arena cap, authenticated-before-inflation processing, cancellation and owned-buffer disposal. The retained LibreOffice 26.8 sample matches independently decrypted CSV and all five baseline diagnostics through Node SDK/Shell and browser/worker SDK. The package suite passed 23,280 tests before the final three authenticated-inner-package controls; all 27 focused package-encryption cases pass. The standalone browser Shell attempt requires a Buffer host dependency and is not counted as qualified.

Current priorities:

1. Continue encrypted-format qualification, including modern ODF writing and remaining BIFF/Paradox profiles; keep the encryption families open until their full requirements pass.
2. Resolve the validated DOCX depth-2048 timeout affecting release CI. The uncommitted readback-cache experiment was discarded because five filtered cases still timed out. Preserve the matrix's routes and assertions.
3. Continue the remaining ledger families and qualify the resulting packed SDK/Shell artifacts.

Recent delivered commits: CFB64 import df1f2d18e, CFB64 export 584fc2e34, and bounded GitHub release notes 27b9a96cb. They are verified on remote main. Published poe-code@17.0.35 points to a8a8a7ef and predates these changes; their containing release remains pending.

Historical run journals and disposable evidence were removed at the user's request. Required test fixtures, canonical inputs and source provenance remain. Prior captures can be inspected in Git history when needed; they are not current-candidate proof. Do not recreate bulky progress journals or commit raw command output.
