# Guarded regex compilation README: released-Array integration

## Status and ownership

August 30, 2026: **AUTHOR DOC CANDIDATE; INDEPENDENT REVIEW AND GUARD RELEASE
PAIRING REQUIRED.** This is not approval of guard source or its publication.
The README describes the proposed guard, not a guard already released in 13.0.3.
No guard target version or successful release is assigned.

Fresh isolated workspace:
`/Users/kjopek/Workspace/poe-code-safe-js-guard-readme-array-integration-author`.
Clone followed immediately by `git pull --ff-only` reached
`8a0a547d26e89e470cc0c74d965f3b099e8a31e9`; applicable AGENTS were read.
Root reports Array 13.0.3 published at `2026-08-30T14:34:10.441Z`, with Release
and Pages verified. This documentation lane does not independently poll releases.

Exactly two publication paths:

- `packages/safe-js/README.md`: present at this base, 51,192 bytes, SHA256
  `b961c0130dad973641522ca25183b742389d0c8889caa6105a975107c083f2f3`.
- `docs/plans/safe-js-regexp-compile-guard-readme-release-handoff.md`: absent at
  this base. This current handoff replaces no published plan or another owner's file.

Only the previously reviewed two Gotchas bullets are added. Three-way merging
their historical README preimage/postimage onto the current README is clean.
Removing those exact two lines must reproduce the entire current preimage.
The released Array wording is unchanged: twelve methods read subsequent values
and membership live; sort collects values before comparator calls and performs
bounded writeback/deletion. Its consistent-comparator stability is not native
comparator-trace parity. Completed-run snapshots do not imply arbitrary
mid-callback suspension, and pending operations may require re-issue.
All eight fenced examples, inline examples, String, Float, locale, Map/Set,
host-policy, FS/browser and canonical API text remain byte-identical to base.
No new example, regex flag, binary `in`, Array behavior or public option is added.

## Immutable provenance and path correction

The earlier author packet remains unchanged at
`/Users/kjopek/Workspace/poe-code-safe-js-regexp-guard-readme-author/out/safe-js-regexp-guard-readme/release-gated-candidate/manifest.json`,
SHA256 `41f8886eb5abbfa44a3c4a44e55529b4ba2b06eee9cff638ff856ff141bce7c4`.
Its base was `ea469259a7d61ab2839457863c445bd9f95155cb`; its two README bullets
are reused exactly, but its old README preimage is not valid for this intake.
Its frozen plan, R5 source checks, author-local runtime receipts and failures
remain historical evidence, not new R7 runtime acceptance.

Earlier Aquinas static review:
`/Users/kjopek/Workspace/poe-code-safejs-fs-type-timing-independent/out/safe-js-regexp-guard-readme-independent/release-gated-static-20260830/manifest.json`,
SHA256 `91bcaa30f0f554213d8f87c203ac95e9934bd6e7d39337bb90b5b61fc82d072a`.
Its approval was conditional on final source and paired publication. A new
Aquinas review is required for this integration; it is not self-approved here.

The supplied R7 locator ending in `candidate/manifest.json` returned ENOENT.
The exact requested bytes are one directory higher:
`/tmp/poe-safejs-compile-final-author-r7.gEcwBs/manifest.json`, SHA256
`a2078d725c4f24d1b611bfbcf45c2c6d173d53d5e47e4ebb5a314c96bb6e3774`.
Its `candidateDirectory` is `candidate`; production postimages are below that
directory. This is a locator correction, not a substituted source candidate.
R7 records the same base as this README integration and 34 source publication
paths: 23 production, nine test roots, one fixture and one source plan.
Those paths are prerequisites, not publications in this two-doc packet.

Root subsequently relayed Laplace's matching locator and STATIC READY: 34
postimages, 23 exact preimages and 11 absences; 28 paths unchanged from R6 and
six changed/new, with three approved production deltas. This is attributed
independent static evidence, not a runtime result. Laplace's runtime remains
held for the CPU window.

## R7 static contract mapping

Selected frozen postimages are checked against the R7 manifest, not live author
files. This is bounded source inspection, not full source certification or a
runtime rerun. The capsule records the exact selected file identities.

- `src/interp/interpreter.ts` forwards the mutable `generatorResume` property
  through the per-node context using an internal getter/setter, retaining the
  compilation context. This repairs the observed skipped second yield without
  changing the README's ownership or reset claims.
- `src/run.ts` parses and validates the executable Module before calculating
  its source hash. Regex-bearing Modules use `hashParsedAst(module)`; sources
  without regex literals retain `hashSource`. `src/parse/hash.ts` shows that
  the latter parses a single node and falls back to a Module for these literals.
  R7 removes actual duplicate parsing rather than discounting work still done.
  This is not a cache, a public AST-input API or a snapshot-marker migration.
- `src/interp/budget.ts`, `src/interp/regex/compile-guard.ts` and
  `src/interp/values.ts` match their previously inspected R5 hashes. The fixed
  ceilings, existing lower Budget limits, physical-work charging, allocation
  ownership/cleanup and stale native callback-wrapper restriction remain.
  The compiler's weak metadata association is not a new compilation cache.
- Standalone `interpret` acquires an owner without reset. Public `run()` acquires
  with reset, retaining its pre-guard per-run behavior. Idle sequential Budget
  reuse is supported; standalone reuse does not replenish spent allowances.
  Independent overlap, active reset and stale exported wrapper generations
  reject with `SandboxError` code `reentry`; valid same-owner nesting is not
  blanket-prohibited. The stale restriction concerns host-callable wrappers,
  not arbitrary native RegExp invocation.
- Actual compilation work that remains is still charged, including physical
  reconstruction work even when logical replay counters are unchanged. No
  equal-tight-budget acceptance or full historical compatibility is promised.
  Literal/constructor/clone/reconstruction/native-export checks add neither a
  native matching fallback nor a universal native-CPU/resource/security guarantee.
  No new public options, environment variables or CLI flags are documented.

These late changes require no alteration of the two previously reviewed bullets.
This statement is scoped to the inspected contracts; independent public regex
continuation and broader source validation remain open gates.

The genuine old-checkpoint pending control intentionally reissues once. It is
not the distinct independent reconciliation case requiring zero additional host
calls. No unrun public coverage is inferred from that author fixture.

## Evidence and release gates

R7's manifest attributes 110 guard passes, 19 legacy-hash passes, four parser
refusal passes, 85 String passes, 39 receiver passes and owned types/lint to
author checks. Its 21 unique focused passes include selector exclusions; these
are not a fresh full-suite, built SDK/CLI or released-package result here.
R7 explicitly retains R6's 9,164 passes, four failures, 49 skips and one load
failure, plus R7 producer-reentry and consumer async-marker fixture failures.
Their historical meaning is unchanged. The earlier R5 SDK string-length 4/3
refusal, CLI steps 2/1 refusal and screenshots remain attributed author-local
evidence only; no screenshot or example is regenerated by this task.

Before publication, root must obtain Laplace's broader independent R7 review,
including public pending/completed regex continuation and the scoped SDK observer
correction; Aquinas must review this current two-doc packet. Publisher must
verify current preimages, source composition and its applicable gates. Publish
these README statements only paired with the approved guard feature. A later
source revision needs contract-delta review, not automatic transfer of R7 claims.
There is no standalone guard claim for released Array 13.0.3.

## Scoped document checks and handoff

The new immutable capsule contains exact README preimage, both postimages, full
two-path patch, selected prerequisite identities and document-check receipts.
Configured formatting covers only these two Markdown files; strict whitespace,
forward patch check against the clean index and reverse check against the live
docs verify intake. Publication paths are unique, and the handoff's absent
preimage is explicit. Prior capsules and source evidence remain untouched.

This lane runs no runtime, examples, tests, install, build or TypeScript compiler;
there is no bulk source hashing. No source, ledger, README in another workspace,
home/SKILL, original-audit archive, branch, commit or push is modified. This
Markdown procedure is agent-executed QA, not an executable QA runner. Root
coordinates independent review and publication; this author does not approve
its own docs.
