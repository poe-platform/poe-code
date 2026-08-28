# PUBLIC Worker preparation-v3 — different bounded review

Date: 2026-08-28. Subject: 10f498874769e4c37d3648f5e9b657414218a4f1. Author DATA: f90e63c1028285c4d720332f0fdb79d704bbaa73. Different-review preseal ea41dd05; exact synthetic recipe seal d5d65de9. No product or author-file edits.

## Verdict and immediate action

**Public source closure is now supplied/authenticated; compiler-only admission needs a small recipe/outer-runner checkpoint. Worker admission remains HOLD.** This is not NP1, guest, native Node, all-jobs-settled, whole-guest-memory, or production approval.

1. Before compiler-only GO, bind TOOLS.json to EMISSION-RECIPE.toolSha256 before parsing/using compiler.origin; enable reportDiagnostics:true if the existing diagnostic rejection is to include syntax/options errors. Freeze a finite outer compiler runner with raw startup capture before admission, regular/no-symlink input and output roots, explicit one-child tool/argv/env/cwd authority, maximum95 outputs plus manifest, per-file2MiB and aggregate output/work caps, failure retention and owned cleanup. No emitted module imports in that phase. No typecheck claim: transpile-only consumes no ambient @types/lib closure.
2. Then execute ONLY the compiler under separate ROOT GO, seal actual95 emission hashes and complete source/bootstrap/package/load inputs. Different review must accept this output before Worker GO. The present source review does not authorize either execution.
3. Before Worker GO, finish the allowlist, profile and actual outcome evaluator described below, and seal outer process containment/capture/reap. Keep11 Workers/10 guest evaluations, peak1, zero retries. L08 must remain a separate heap-only Worker, not an eleventh guest.

## Concrete source findings

### C1 — compiler tool authority is not bound by its supplied grant

compile-entry.mjs:10-19 checks grant.recipeSha256 and archive SHA, then reads TOOLS.json and trusts its compiler.files[0] origin/hash. EMISSION-RECIPE.json contains toolSha256, but compile-entry never compares it. A changed TOOLS manifest plus matching changed compiler body can pass this entry's local checks while the recipe/grant stay unchanged. This is an admission-binding gap, not evidence that current pinned compiler bytes differ or an attempt to sandbox malicious host JS. Our read-only hashes match all three current Node/compiler/package records. Small fix: hash raw TOOLS bytes against recipe.toolSha256 before use; preserve outer selected-source authentication as well.

### C2 — the syntax-diagnostic gate is incomplete

compile-entry.mjs:27 passes no reportDiagnostics:true. Authenticated TS5.9.3 body, line145427, collects program.getSyntacticDiagnostics and getOptionsDiagnostics only under transpileOptions.reportDiagnostics. Later emitted.diagnostics inspection is therefore not a complete syntax/options gate (it may still receive other diagnostics). No compiler was imported/run, no malformed-source dynamic proof, and no assertion that these pinned94 sources are malformed. Enabling that option is a narrow recipe correction; it still does not produce semantic typechecking or declaration files.

### W1 — current Worker builtin inventory cannot load the selected public closure

MODULES.json intentionally has no executable files and publicEntry.status=emissions-held. In addition to this deliberate hold, its worker builtin list lacks node:util, node:async_hooks, node:fs/promises and node:path, all in the authenticated runtime-reachable graph. load-guard.mjs:27-29 rejects them. Populate the exact graph-required builtin authority during emitted-module closure review, not a broad builtin wildcard. These imports belong to trusted engine implementation, not guest-visible fs/process authority. Bind package/module format and bootstrap files too; do not rely on ambient ancestor package metadata or guessed public-root imports.

### W2 — stale current profile and missing final judgement

PROFILE.json still says candidateSourceInstances=9/candidateSourceGuests=9 and carries K4_PUBLIC66_MISSING_LINT and the old pre-postcopy-credit-release blocker. CASES now declares11 implemented instances/10 guests; PUBLIC98 includes lint and its closure; revised parent retains credit until delivery/cleanup. Replace these stale current-profile fields explicitly while retaining historical originals.

parent-entry.mjs:34-40 captures receipts and rejects unconfirmed cleanup/exit/status2, but does not compare expected stdout/effects/status for its cases. For L08, supervisor.mjs:85 exempts missing terminal, and line93 computes status0 on normal exit with no failures; heapEnforcement.observedOom is merely recorded. A normal heap-loop exit can therefore finish this launcher without an enforcement failure, despite normalLoopExitIsNegative:true. Do not call launcher exit0 a WRQ pass. Before Worker GO supply a bounded, presealed outcome judge that compares all case observations and explicitly rejects L08 normal exit while requiring actual OOM+exit+cleanup; preserve raw receipts. This is a missing experiment evaluator, not demonstrated heap protection failure.

## S1–S6 repair assessment

- S1: cleanup enrollment precedes reserve/authorize/allocation. FINAL_ACK closes operation refs but retains operation credit until a separate delivered control or exit cleanup. retire nulls all active payload/request refs before release. Journal credit is reserved before envelope serialization and retained to cleanup. A1MiB NUL response can honestly refuse the16MiB ledger before envelope encoding; maxima are not simultaneous guarantees. Actual public bridge retention/K3 remains unqualified.
- S2: supervisor finally closes owner then reconciles outcomes independent of terminal; outcome.reconciled prevents duplicate promotion. The delivered predecessor cannot be manufactured by terminal counts. Actual cross-port scheduling/engine delivery remains unrun.
- S3: actual owner registerCleanup rethrows the original rejection and records it; parent cannot advance closed/FREE after failed operation.close. cleanupSettled and cleanupClosed differ. Actual Worker exit/parent cleanup integration remains unrun. Synthetic controls use a disclosed owner model because actual owner imports the uncompiled FsError fixture dependency.
- S4: control kind is own-data/scalar before schema lookup; phase/tag/count are checked before receive payload copy; frame counter admitted before publish copy; jsonSize preflights encoding; complete upload fatal-UTF8 validation precedes provider.start. This is bounded trusted-peer transport, not arbitrary concurrent hostile SAB safety or preemption.
- S5: guest cache now counts UTF8 rather than UTF16. DATA near-neighbor: two quoted200000-cat-character strings are1200004UTF8 bytes, over1048576, despite400004UTF16 units. No guest/scaffold execution; cache identity and actual public intrinsic support still require Worker observations.
- S6: only data/json readText and data writeText enable typed conversion; sink/stdin/control failures retain escaping originals. Synthetic same-object sink/FS-route controls pass; actual compiled FsError and guest catch/mapping are not thereby qualified. All28 FS codes remain exact; absent/own-undefined optionals normalize to null, no getter invocation or reason cloning is introduced.

## Actual tests, source and DATA authentication

Ten unchanged-author-recipe groups exercised through byte-identical five helper modules: S1a/S1b/S1c/S2a/S2b/S3a/S4a/S4b/S4c/S6a: **10/10** in one ordinary Node child; exit0, empty stderr, natural close, owned root removed. Zero Worker/compiler/engine/guest/native-subject execution. S5a is DATA/source only; L08a is source only. Thus **NOT12/12 executed controls**, NOT10 guest evaluations. The exact synthetic owner/provider and limitations were sealed before execution in CONTROL-ADMISSION.md. No actual owner module, public SafeJS or compiled FsError was imported; no source-transform or model result is credited to them.

Authenticated source inventory:33 frozen files; SEAL lists31 (PRESEAL.md and SEAL.json itself excluded). Our input manifest additionally binds both excluded files. PUBLIC98 archive SHA8a65517b0105b3fbfb9337eda671442fa6c44d6b00185b98199ca05f17c2e637 verified; all98 source/package bodies validated by byte count/SHA256/Git blob and membership through15 hashed trees to public bb23 commit. All321 declared graph edge source spans and targets validated; reachability recomputed94 type/runtime,93 runtime;18 type-query spans checked; all95 emission inputs matched. This is declared-edge source verification, not a new full TypeScript-parser completeness proof. No private repository was read. Public metadata retains package dependencies but none was installed or inferred to be guest authority.

Tool rehash: Node112989184 bytes +typescript.js9112572 +package3620 =122105376 bytes, streamed in65536-byte scratch; compiler body additionally read as SOURCE to identify diagnostic gate. No binary decoded as text; no compiler imported. Initial reviewer DATA predicate incorrectly required9 node builtin edges to resolve to source files; that assertion failure is preserved in DATA.json. Corrected predicate explicitly accepts only builtin category/node: specifier/null target. Old author ad6c9a4c binary-read failure and all previous review history remain unchanged.

## Minimum next finite experiment preseal

Compiler-only: exact corrected compiler/source/recipe/tool/grant bytes, PUBLIC98 membership, FsError support blob d466866ce93c4feced56e2bd5fe4c41637e62226, output paths and module format, one compiler child, timeout plus escalation/reap, byte/work caps, raw captures and failed partial-output preservation; stop on authentication/cleanup error. Actual emissions remain null today. Do not combine this with importing/emitting a new API or Worker launch.

Worker-after-emission: exact11/10 selection and per-case schedule/receipt assertions; corrected builtin/load inventory incl bootstrap and heap entry; outer startup capture before grant parsing; actual termination/exit and parent-job cleanup rather than timeout-as-success. K1 stays frozen literal fixture scope (not general descriptor-safe CLI). K2 needs actual public postcopy and caught typed error/source cache identity observations; raw-to-Shell remains outside this fixture. K3 needs actual precharge/retention evidence without RSS/all-jobs claims. K4 needs authenticated loaded bytes and denied-load controls.5s is admission cutoff, not a promised whole completion deadline; unconfirmed exit/uncooperative cleanup must remain unclean and require outer containment. F05/private ABI8 remains deferred, uninspected, unexecuted.
