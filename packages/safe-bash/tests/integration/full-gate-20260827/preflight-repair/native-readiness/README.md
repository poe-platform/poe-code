# Native readiness and bounded scheduling — 2026-08-27

## Exact tree prerequisite recovered

Set `TREE_NATIVE_BIN=/tmp/safe-bash-tree-external-oracle-TbVJVK/tree` for the
future reviewed gate. This is Dirac's retained regular-file development oracle,
not a new product dependency, PATH replacement or changed profile:

- Binary: tree2.2.1,114488 bytes,0755,
  SHA256`34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
- Source archive beside it: `tree-2.2.1.tar.bz2`,56345 bytes,0644,
  SHA256`e911c4a2bea53586cc7be6f3d7d7f4d9c2f2bcbbad77d30700b31046e38f4bc5`.
- Both match unchanged `tree/EXTERNAL-ARTIFACTS.json` and historical provenance.
  That record attributes the archive to the official OldManProgrammer/unix-tree
  GitLab2.2.1 archive and records the Apple clang21 build. This audit does not
  claim a fresh upstream download, reproducible rebuild or supply-chain attestation.
  The alternative original build-tree path was observed but is not the selected
  `TREE_NATIVE_BIN`; no replacement hash is accepted.

With the explicit binding, **49/49 native assets authenticate, zero issues**.
The two tree payloads retain their bytes/modes before and after each check.
Only `tree --version` executes: four recorded audit calls and one preliminary
manual identity call. No native golden is regenerated, install/download made,
Dirac process interrupted, private checkout accessed, or external payload changed.
The fixed temporary paths are availability observations, not durable storage;
recheck all pins at actual launch and after staging.

**Native readiness is not gate admission.** The existing policy deliberately
remains bound to b494 and its known refusals. No new source cohort or policy seal
is manufactured here, and no whole-product suite is launched.

## Scheduling defect and mechanical repair

The original package evaluator appended forwarded flags after discovered test
filenames. On actual Node22.22.2, passing `--test-concurrency=2` there did not
enforce the requested bound: all six miniature test files overlapped. The
one-line package change places forwarded arguments before the filenames.
Discovery, exclusions, assertions, loader and default invocation are unchanged.
No regex deadline, search10s timeout, budget, product source or worker policy changes.

The next reviewed whole-gate command must explicitly be:

```sh
npm test -- --test-concurrency=2
```

This is a two-file scheduling bound, not a limit on asynchronous work inside a
test file or a guarantee against cohost load. The bound is explicit, not a new
default for bare `npm test`. The successor policy must bind the exact value2;
do not rely on Node to reject zero/nonnumeric values as policy validation.
Official Node22 CLI documentation describes this flag as test-file concurrency;
the actual argument-order observations here are independently captured local
experiments, not inferred solely from that documentation.

Final v4 runs the actual historical and corrected package evaluator programs,
with unchanged six temporary `.test.ts` fixtures and regular-file copies of the
existing development tools. Historical maximum active files6; corrected maximum2;
all six fixtures complete in each. An unknown CLI option now rejects before any
fixture starts. This is not a product-suite timing or performance claim.

Failed investigator attempts remain in `evidence.json`: v1 detects the trailing
flag violation; v2/v3 already show the corrected bound but their extra negative
controls wrongly assume Node rejects concurrency0 or a nonnumeric value. This
Node accepts those and executes fixtures. V4 uses a genuinely unknown option;
the zero/nonnumeric observations are retained, not relabeled as product fixes.
All temporary test trees and copied tools were removed after each attempt.

## Independent reviewer handoff and continued hold

Root has approved the successor typing direction: cold plain typecheck exit78
is an explicit prerequisite observation, neither a type pass nor failure;
`typecheck:all` builds once before full current source/strict consumers. Do not
duplicate that production build in the successor launcher. Implementation of
the candidate-specific admission policy waits for review and root's frozen SHA.

Please bundle these checks with Plato's distinct typing-workflow review:

1. b9559de5/547160e8: exact authenticated data exclusions, current-source and
   missing-current-consumer controls, built-resolution/negative diagnostics.
   Plato's separate three callback annotations are not independent credit here.
2. 21049bed plus3ee476a8: mandatory missing/changed/nonexecutable native refusals,
   dirty/source-binding and staged-immutability guards; both public routes must
   return78 without importing the suite launcher.26/26 author controls include
   the two original guard mutants; independent acceptance is still requested.
3. This one-line argument-order fix: independently exercise the actual evaluator
   and undo the ordering in a temporary mutant. Confirm two-file scheduling,
   unchanged discovery and no relaxed product deadlines. Tamper only with copied
   native prerequisites, never Dirac's retained originals or saved goldens.

Reproduce this bounded audit into a new file with:

```sh
node tests/integration/full-gate-20260827/preflight-repair/native-readiness/audit.mjs /tmp/NEW-NATIVE-READINESS.json
```

The audit records source and asset hashes, before/after tree identities, raw
stdout/stderr, CLI programs and scheduling events. Its current source commit
plus the explicitly recorded package bytes identify the author input; it does
not falsely label the uncommitted package patch as an untouched commit. No main
dependencies/lockfile or historical whole-gate captures are changed.
