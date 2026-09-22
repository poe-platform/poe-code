---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: Resolve ssconvert functionality and compatibility gaps
readiness: draft
setup:
  prompt: Execute the user-authorized ssconvert gap-resolution goal. Read root and
    scoped AGENTS.md; preserve unrelated work. Execute tasks in order,
    maintaining docs/ssconvert/gap-resolution.json and gap-resolution.md with
    actual candidate/profile evidence. Authorization covers implementation and
    verified atomic delivery under session rules; do not ask optional preference
    questions. This setup overrides inherited behavior.
tasks:
  - id: current-gap-inventory
    title: Authenticate current gaps and reference environment
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Read docs/ssconvert/final-coverage-and-delivery.json, usage-draft.md, function-coverage.json, optional-runtime-extension-coverage.json and numeric-current-verification.md. Inspect subsequent packaging/portability commits 7d97a1731 and d53488b24 before repeating stale findings. Create a structured case ledger covering every requested family with source/profile/candidate hashes, actual code owner, native applicability, smallest reproducer, neighboring control, classification and completion proof. Resolve prior reference-profile binding drift without editing hashes into apparent passes. Provision authenticated native Gnumeric in isolated out using an available Linux host/container or build environment; no Docker/ssconvert binary is initially on PATH. Read external-service adapter contracts and set up isolated owned fixtures where required. Record absent runtime cells as unresolved and keep progressing on independent deterministic work.
    status:
      implement: open
      commit: open
      release: open
  - id: pwd-resource-identity
    title: Align actual cwd, resource identity and diagnostics
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Inspect packages/ssconvert/src/contracts.ts, engine.ts, io/index.ts, io/publication.ts and resource-uri.ts plus packages/safe-bash/src/commands/ssconvert/index.ts. Reproduce conflicting PWD and actual VFS cwd with an original public-engine/Shell test. Carry actual working-directory identity through an explicit SDK environment or resource contract, preserve GETENV(PWD) and exact exported environment rather than overwriting user variables, and qualify logical symlink-equivalent names only through explicit filesystem identity. Cover relative/absolute paths, missing input, exporter inference, write failures, output staging, split/graph outputs, missing/empty PWD and cancellation. Inspect visible diagnostic screenshots and public type consumers.
    status:
      reproduce: done
      implement: done
      test: open
      commit: done
      release: open
  - id: lotus-named-ranges
    title: Implement applicable Lotus named-range semantics
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Inspect codecs/lotus.ts and lotus metadata/formula/workbook name owners. Validate the current Named ranges not implemented diagnostic against the authenticated native source; if native also lacks this behavior classify native parity separately while implementing the requested useful capability. Add original small WK1/WK3 records for global/local names, ranges, relative/absolute refs, duplicates, case, invalid lengths and references, then expose imported names through the actual workbook model and recalculation. Preserve unknown records, sheet ownership and neighboring Lotus fixtures; qualify Gnumeric XML/XLSX export and readback.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: biff-external-and-token-formulas
    title: Complete applicable BIFF formula read/write support
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Inspect codecs/biff-formulas.ts, biff-write-formulas.ts, biff.ts and the explicit externalReferences capability. Inventory every currently refused token and version, SupBook/ExternSheet/name ownership and Gnumeric behavior. Implement external-workbook and detached-sheet references and remaining applicable tokens using structured formula nodes; no automatic link fetch, execution or silent cached-value substitution. Read/write cross-check original BIFF version fixtures, shared/array formulas, missing bindings, invalid indices/spans, cancellation and round-trip names. Preserve external-reference identity and effects in XML/XLSX and SDK/Shell output.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: encrypted-format-admission
    title: Define encrypted-format contracts from actual native support
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Validate encrypted BIFF Excel, OpenDocument and Paradox refusals against actual native support and primary encryption specifications. Inspect office-package crypto and codec reuse plus contracts.ts, cli.ts and providers. Define per-format password/secret acquisition, errors, decrypt-only/write support, format/version algorithms, byte/work bounds, CLI/SDK parity and authenticated publication. Secrets are explicit host inputs, never argv/debug/log output or ambient config. Native itself refusing a format is evidence of compatibility, not justification for declaring requested encryption support delivered. Record unsupported algorithms explicitly and schedule their implementation if applicable to the requested target. Do not fabricate a universal password flag.
    status:
      implement: open
      commit: open
      release: open
  - id: encrypted-format-implementation
    title: Implement and independently qualify applicable encryption
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Use the validated format-specific encryption contracts and primary published vectors, never invent crypto. Reuse vetted available primitives; add a shared owner only when required. Deliver each format/algorithm as its own atomic improvement. Cover correct/wrong/empty passwords, binary passwords and encoding, tampered headers/payload/authentication, unsupported versions, truncation, excessive KDF/model work, encrypted package paths, stream chunks, cancellation and no invalid plaintext/output publication. Compare native cross-read where supported and independent format tools where native lacks the requested extension. Document any unauthenticated legacy cipher behavior honestly; no strength or authentication claim from parsing a header.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: optional-language-functions
    title: Complete required Perl/Python scalar functions and Unicode
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Inspect formulas/optional-providers.ts, runtime-functions.ts and optional-runtime coverage/source receipts. Implement PERL_DATE, PERL_SED, PY_PRINTF and Unicode PY_CAPWORDS through bounded compatible semantics, pinned runtime Unicode/casing/whitespace and locale/timezone profiles, explicit clock and existing shared interpreter capabilities where suitable. Preserve sample signatures, coercion, error/array conversion, namespace replacement and default absent-plugin behavior; explicit opt-in remains. No arbitrary native module loading or unbounded JS RegExp substitution. Source-disabled Guile/debug/external manifests do not become new shipped APIs. Differentially qualify Unicode expansion/surrogates, formatting flags/width/precision/errors, pattern grammar/captures, dates/DST and cooperative cancellation.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: optional-data-and-stream-services
    title: Complete required database and ATL lifecycle services
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Inspect authenticated GDA/ATL source and contracts for EXECSQL, READDBTABLE and ATL_LAST. Provide declarative explicit trusted data-source/FIFO adapters with namespace/array result conversion, diagnostics, ordering and bounded watcher lifetime. Never discover ambient DB credentials or host FIFOs. Match transaction/error/resource ownership and cancellation with real isolated fixture services as manual Markdown QA plus fast injected unit controls. Prove actual result bytes/database effects and retire owned connections/watchers before settlement. Inventory loader/extension initialization effects relevant to CLI; exclude GUI-only and source-disabled services only with exact source evidence.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: numeric-current-reproduction
    title: Reproduce and minimize current numerical differences
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Read numeric-current-verification.md, numeric-current-*-comparison.json, numeric-current-gates.json and actual numeric primitive/function owners. Re-run the recorded direct LN1P/log1p/acos and higher-q Bessel cohorts against compiled current source and authenticated matching oracle. The historical 56 differing cases are not 56 missing functions or a current verified failure count. Retain exact binary64/HEXREP expectations, profiles, seeds, route/ULP/relative errors and minimized original deterministic regressions. Discard no hard input to obtain parity. Classify native rounding versus mathematical accuracy explicitly.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: numeric-current-repairs
    title: Repair validated numerical-route mismatches
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      For every minimized current failing numeric regression, repair the responsible shared primitive or route with TDD and independent holdouts. Qualify LN1P public domain before wiring private log1p; preserve source FMA/order/reflection/phase semantics for Bessel and acos. Cover signed zero, subnormal/overflow, poles, NaN/infinity, integer order, high-q regimes, errors, work cancellation and replay. Keep expensive broad oracles in Markdown manual QA; small fast unit vectors prove each repair. Each algorithm improvement has its own commit and relevant ledger update. Never silently relax exact compatibility into a tolerance pass.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: format-record-roundtrip
    title: Close format/version/record semantic coverage
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Use coverage.json, canonical differential register and codecs/provider manifests to map every applicable importer/exporter version/record effect to executed cases. Distinguish preserved opaque bytes from understood/recomputed semantics and diagnostic loss. Qualify styles, names, formulas, merges, comments, charts/objects, external links, unsupported records, encodings and metadata through independent parse/edit/export/readback. Reduce every defect to original small memory fixtures and repair before marking the row complete. Resolve generated/conditional semantic inventory omissions and unknown case counts rather than claiming full support from exporter listings.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: rendering-and-solvers
    title: Qualify charts, printing, fonts, solver and analysis accuracy
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Inspect rendering/chart, rendering/print, rendering/images, codecs/pdf, solver and analysis owners and matching source/profile registers. Execute independent chart/print screenshots, PDF text/geometry/font checks, page-break/range/header/footer cases, Unicode/CJK/RTL where claimed and clipping/style/object fidelity. Validate goal-seek/linear/nonlinear optimization and analysis against known solutions plus matching native optional profiles; an installed solver or callable stub is not accuracy evidence. Repair reproduced defects with fast unit controls and separate bounded manual QA. Record unavoidable platform-dependent rendering profiles explicitly without silently shrinking required support.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: public-and-optional-qualification
    title: Verify optional profiles and packed public consumers
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Qualify all applicable optional profiles recorded in optional-runtime-extension-coverage.json against activated authenticated references and actual services; source-disabled/GUI-only distinctions remain documented. Revalidate packed poe-code/ssconvert and scoped safe-bash command exports after the existing bundling fixes. Install artifacts outside the repo with no private workspace resolution/native PATH, execute real XLSX to CSV and edited CSV to XLSX readback through public SDK and Shell, compile strict NodeNext consumers and check worker/browser startup where advertised. Test CLI/SDK parity, authority controls, cancellation/cleanup and replay. Use a different stress/fix agent for Safe Bash integration as scoped policy requires.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
  - id: final-acceptance-and-publication
    title: Close the ledger and verify complete delivery
    prompt: |-
      Execute the authorized ssconvert gap-resolution goal on current main. Read AGENTS.md and docs/plans/ssconvert-gap-resolution.md; preserve unrelated edits and historical evidence. Product logic belongs in packages/ssconvert or its actual shared owner. Validate claims on current source against Gnumeric 1.12.61 authenticated archive SHA256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12 and format specifications before fixing. Use TDD: fast original failing memory/memfs tests before runtime changes, no native/LLM/disk unit dependencies. Preserve explicit VFS/network authority, cancellation, budgets, owned cleanup, CLI/SDK parity and checkpoint/replay. No native fallback, ambient credentials or arbitrary plugin execution. Missing proof is not missing implementation; source-disabled/GUI-only features are excluded only with concrete ssconvert relevance evidence. Use docs/ssconvert/gap-resolution.json and gap-resolution.md for current case evidence; temporary inputs/output go under task-owned out/ssconvert-gap-resolution and are purged after reduction. Atomic Conventional Commits stage explicit owned files, run appropriate maintained manual checks, push main through normal hooks, verify remote ancestry and monitor required GitHub publication while continuing independent work. Safe Bash changes require scoped instructions, an assigned integration owner and a different stress/fix agent; preserve seals and exact integration registration. Never mark a task complete with unresolved required cases, stale hashes, skips, TODOs or merely registered function names.

      Reconcile every requested case and every applicable claimed-support obligation to current executed evidence. Rewrite stale blockers after actual proof, preserve historical failed attempts and distinguish implemented/verified/excluded/unavailable. Update existing usage and support text without adding unrequested root README sections. Run maintained npm run build, npm test and npm run lint for the integrated broad change, investigate failures and timeouts, inspect visible CLI and document screenshots, then deliver verified atomic commits through normal main hooks. Verify remote-main ancestry, successful required GitHub workflows, actual registry versions/provenance and installed-artifact smoke. Notify the user through authorized hey-boss only once ready. No automatic archive, full parity declaration or goal completion with required work remaining.
    status:
      reproduce: open
      implement: open
      test: open
      commit: open
      release: open
teardown:
  prompt: Reconcile the current structured ledger and publication outcomes. Keep
    goal active and report exact unresolved requirements unless every mandatory
    case has been resolved and required remote delivery/publication verified.
    Preserve unrelated changes and historical failed evidence. Clean only
    task-owned ignored scratch; no blanket staging or archive.
finalization: pending
---

# ssconvert gap resolution

## Target and baseline

Resolve the reported functionality gaps and prove the claimed ssconvert command/SDK support against released Gnumeric 1.12.61 and the relevant file-format specifications. Initial source baseline is ec51e54b9 on main. The later packaging and portability fixes supersede the audit's old standalone-import blocker; revalidate them rather than rebuilding them.

This plan covers encrypted Excel/ODF/Paradox applicability and support, BIFF formula gaps, Lotus names, optional functions and data/stream services, Unicode PY_CAPWORDS, numerical differences, PWD identity and diagnostics, format preservation, chart/print/font fidelity, solvers/analysis, optional profiles and installed artifacts. Arbitrary native plugin loading, ambient host access and GUI applications are outside the ssconvert product contract; exact released-source relevance determines profile exclusions.

## Completion proofs

- [ ] Current gap inventory binds source, profile and candidate identities; stale audit statements are classified.
- [ ] Conflicting PWD cannot misidentify actual resources; SDK/Shell diagnostics agree.
- [ ] Lotus names and applicable BIFF formula records survive import, recalculation and independent export/readback.
- [ ] Each applicable encrypted format has verified password, corruption, budget and publication behavior.
- [ ] Required optional scalar functions, Unicode, DB and FIFO services have actual effect and lifecycle evidence.
- [ ] Every recorded numerical difference has a current disposition and all applicable repaired cases plus independent holdouts pass.
- [ ] Applicable format, rendering, solver and optional-profile obligations map to executed semantic cases.
- [ ] Public packed SDK and Shell consumers operate without private workspace installations.
- [ ] Maintained integrated gates and inspected visual evidence pass; unavailable cases are unresolved.
- [ ] Atomic commits are verified on remote main and required GitHub publication and installed smoke succeed.

## Evidence and autonomy

Durable case records belong in docs/ssconvert/gap-resolution.json and gap-resolution.md; manual procedures belong in docs/plans. Each record includes exact input construction, expected and observed bytes/status/effects, source/profile/candidate hashes, classification, repair/regression checks, commit and remote/publication references. Do not mutate historical receipt hashes into passes. Task-owned temporary source archives, native builds and captures belong in out/ssconvert-gap-resolution and are reduced and purged after use.

At creation, Python 3 and Node/npm tooling are available; native ssconvert and Docker are absent from PATH. Reference setup is task work, not an assumed prerequisite. External data/stream/network use requires explicit owned fixture bindings. Missing external availability never closes a row and does not prevent independent deterministic repairs.

## Maintained verification

Use the declared @poe-code/ssconvert workspace build closure, npm test --workspace=@poe-code/ssconvert and npm run lint --workspace=@poe-code/ssconvert for relevant atomic changes. Focused Vitest selections establish red/green evidence but do not replace maintained pre-push checks. Broad integration uses npm run build, npm test and npm run lint. Safe Bash changes follow its integration-input registration and stress/fix ownership policy. Ad hoc visible CLI verification uses screenshots; no screenshot unit tests.

### Executed optional-function QA

1. Bind a public Shell to MemoryFileSystem containing `/input.csv` with `0` and a newline. Register only the explicit ssconvert plugin with bounded limits and the named optional runtime binding.
2. For PERL_DATE, inject clock `Date.UTC(2024, 1, 29, 0, 30)`. Execute `ssconvert --set 'A1==PERL_DATE()' --recalc -T Gnumeric_stf:stf_csv /input.csv fd://1` under UTC and America/Los_Angeles. Require respectively `20240229` and `20240228`, empty stderr and exit zero. Inspect the command-output screenshot.
3. For PY_CAPWORDS, enable `pythonSampleFunctions`, UTF-8 locale and explicit `CommandProfile.argumentEncoding: "utf8"`. Execute `ssconvert --set 'A1==PY_CAPWORDS("straße ßETA ΟΣ")' --recalc -T Gnumeric_stf:stf_csv /input.csv fd://1`. Require CSV string `"Straße Sseta Ος"`, empty stderr and exit zero; inspect the screenshot. Retain namespace, ASCII-profile and exporter-selection controls separately.
4. Authenticate CPython 3.14.2 Unicode16 generated type data against the recorded SHA256. Compare every cased, case-ignorable, whitespace and case-delta character with CPython capwords in initial, lowercase and preceding/following sigma contexts. The executed 28356-case source corpus passes; repeat matching activated native plugin qualification separately before closing that profile.
5. Reconstruct the owned encrypted ODF fixture from `docs/ssconvert/encrypted-odf-applicability.json`. Bind it to MemoryFileSystem as `/encrypted.ods`, with `/target.csv` containing `untouched` and a newline. After the selected maintained SDK build, run `ssconvert /encrypted.ods /target.csv`; require the explicit encrypted-package refusal, exit one, no stdout and byte-identical target. Inspect the screenshot. Native plaintext/encrypted controls and independently verified crypto are separate applicability evidence.
6. Generate local artifacts through `scripts/package-safe.mjs`, pack and install them physically outside repository ancestors. Compile advertised ssconvert imports with strict NodeNext and `skipLibCheck=false`; inspect trace origins and tarball/lock integrity. Execute public Shell CSV→XLSX with `--set=B2=17`, then XLSX→CSV readback; require `Ada,17`, unchanged input/keep bytes and actual-cwd missing-file diagnostics with conflicting exported PWD. A private checkout manifest/dist copy is not the release artifact. This local cell does not qualify registry publication or the final candidate's entire SDK artifact.
7. Dispose every Shell. Reduce screenshots, failed harness attempts and numeric/profile observations into the durable ledger, then purge only owned disposable helpers/captures when no longer needed. These steps are agent-executed QA, not a maintained QA script.
8. Reconstruct the four framed BIFF8 inputs from `docs/ssconvert/biff-local-span-gap-proof.json` inputHex and verify each SHA256. Keep BOUNDSHEET declarations before native EXTERNSHEET resolution. Execute native and the rebuilt public SDK `runCommand` with `--recalc -T Gnumeric_stf:stf_csv`; require `1`, a blank row and `3`, newline terminated, status zero and empty SDK stderr. Inspect CLI-output screenshot. Forward/reversed Ref3D and Area3D local spans are separate cases; do not close BIFF7 or external-workbook cases with this evidence.
9. Reconstruct twelve original inputs from `docs/ssconvert/biff-deleted-reference-gap-proof.json`, verify SHA256 and execute the same native/public CLI recalculation route. Require byte-identical `#REF!` plus newline, status zero and empty SDK stderr for BIFF7/8 and each RefErr3D/AreaErr3D token class. Inspect the readable twelve-case screenshot. Explicit deleted tokens are independent of deleted EXTERNSHEET endpoints; the latter remain a separate obligation.
10. Reconstruct fourteen original legacy inputs from `docs/ssconvert/biff-legacy-reference-gap-proof.json`, verify SHA256 and compare native/public CLI recalculated CSV. Cover signed link fields, both span directions, areas, current/self/deleted endpoints, token classes and ordinary/shared coordinates. Preserve deliberately distinct global/worksheet tables. Inspect the fourteen-case screenshot. Exercise BIFF7 export/reopen of the forward span separately: the currently reproduced First:Last→First:Middle defect remains an implementation obligation; passing import cells do not qualify that writer.
11. Reconstruct the six physical-sheet inputs from `docs/ssconvert/biff-legacy-roundtrip-gap-proof.json`, verify SHA256 and run the rebuilt CLI with `--recalc -T Gnumeric_stf:stf_csv -O sheet=Middle`. Require sums6,3,5,6,3,5 for the six recorded span directions. Compare and preserve the native BIFF7 reader's differing values rather than labelling them passes. Verify pinned independent reader/writer source hashes and unchanged writer encoding. Export each input through the public CLI to explicitly bound XLSX, then execute native XLSX→CSV with recalculation and require the intended physical sums. Replay the fourteen prior legacy controls and inspect the readable six-case screenshot. Wider legacy encoding/profile ambiguity remains a separate qualification obligation.
