# R3 independent repair review v20 — HOLD, exact source defect

2026-08-28. Not ACCEPT SCOPED for closure. No gate/native/actual-tool GO.
Only this new review directory changed. No product, fixture, author, earlier
reviewer, root/config, declaration, private or failed-run root changed.

## Receipt and failed independent cohort

Freeze: **bc60e57b246bf2be853004bd7b5a301e3ee4a339**, committed
2026-08-28 10:55:01 -05:00. Timing was post-author and post-source-inspection,
not blind/pre-author. Source **437778996f60109e212e20b1b242455866fda285**;
evidence **2ae74702def6b06f1519c9a88c12d6f748611250**. Tool recipe
**adcb1467caad7165361f035f110b40dd1bbdf07d**; evidence
**26de751f7c1e2e39edfe38c976dc52ce9516fac3**.

The ONE authorized Node invocation exited **1**, SyntaxError at `review.mjs:402`.
The reporter mock's load() options are missing a closing object brace. This is
MY harness defect, not an author/product failure. Parsing stopped before any
statement: **0 checks started/passed, 0 stub dispatches/module loads, 1 harness
failure, 0 skips, all 53 planned checks UNEXECUTED** (3 DATA, 1 SOURCE, 10 SYNTHETIC,
39 STUB; the latter included a 71-fixture helper loop). No retry, source change,
syntax-check replay, or substitute runner occurred. Frozen broken source remains
intact. `ATTEMPT.json` preserves exact argv, exit and raw stderr. It is a manually
transcribed terminal receipt, not a runner-produced success record.

The process exited synchronously; no runner timers, owned subject children or
real scratch roots were created. No cleanup/signal/process probe was needed.
The runner could not create RUN-CLAIM.json or RESULTS.json. Administrative Git
and text inspection are separate from the failed cohort; never count them as
successful synthetic controls. Author45/17 remains author proof only.

## F01 — primary failures are overwritten by cleanup

SOURCE finding, not independently executed reproduction:

- `tests/commands/table-text-stress/support.ts:67`: a failing awaited `rm` in
  finally replaces an earlier sentinel write, native-call or assertion exception.
- `tests/commands/table-text-stress/shared-stdin-fix/support.ts:86`: final sentinel
  verification, child rm and parent rmdir can each replace an earlier failure.
  A foreign sibling correctly makes parent rmdir refuse ENOTEMPTY, but that error
  replaces the primary native failure. `verifyOracle` has the same parent-rmdir
  precedence issue at line59. This does NOT justify recursive parent deletion.
- `tests/commands/diff-patch-stress/gnu-target/oracle.ts:15`: withNativeScratch's
  finally replaces the callback's thrown reason when rmSync also throws; this
  affects the newly wrapped identity, auxiliary and followup callsites.
- `tests/commands/stream-inspection/oracle.ts:38` and
  `tests/shell-stress/helpers.ts:105`: nested finally attempts both owned removals,
  but can lose the original error and also overwrite the first cleanup failure.

Minimal author repair: explicitly retain whether a primary throw occurred and its
original value; attempt/await all owned cleanup while retaining secondary cleanup
diagnostics separately; rethrow the original value unchanged, including undefined
and non-Error reasons. If there is no primary, surface cleanup failure rather than
success. Do not mask failure with a late successful return, suppress ENOTEMPTY,
mutate arbitrary/frozen thrown objects, delete foreign children, or widen cleanup.
Some masking existed before this repair; this review does not attribute every
instance to source437 or claim it caused any of the historical132 failures.

Required independent controls remain UNRUN: primary-only, cleanup-only,
primary-plus-cleanup, both cleanup failures, pending/late cleanup, and ordinary
foreign parent/sibling canaries. A new version/authority is needed; do not retry
the v20 cohort or edit its sealed runner to hide this failure.

## Qualified source observations, not runtime passes

- All15 selected live files equal source437 according to scoped Git diff; source
  commit itself changes exactly those15.13 fixture/helper replacements are declared
  for a NEW f5-based candidate, plus2 separately versioned driver files. The
  original frozen corpus, search harness and pipeline source equal f5. Three
  canonical test bodies change intentionally (two reporter wrappers and mount
  fixture); that is not unchanged632-body proof for a successor.
- Table cleanup now surrounds first writes and awaits exact-root removal. Shared
  native/version parents are unique, and parent deletion is empty-only rmdir.
  Mount registers its after-hook before child acquisition and removes only the
  acquired child recursively, then parent nonrecursively. This is the right
  ownership shape; foreign safety and cleanup settlement were NOT stub-validated
  here. Do not infer mount's node:test error aggregation from plain finally.
- Table argv/input/locale/PATH, original sentinel/file assertions and shared
  historical argv0 remain. New shell TMPDIR is separate from HOME/cwd; hostSnapshot
  still includes arbitrary ordinary files, including sh-thd-like names. No semantic
  filename filter was added. Patch/stream add TMPDIR without changing expected
  oracle bytes; existing root containment checks precede dispatch. No native tool
  equivalence or real scratch cleanup was measured.
- benchmarkTypeInvocation selects `<source>/node_modules/typescript/bin/tsc` after
  validating package/bin/lib entry metadata against the root dependency receipt;
  version5.9.3, benchmark cwd, `--noEmit -p tsconfig.json` retained. Existing audit
  records only root `tsconfig.build.json` production builds; final one-build
  assertion remains. No compiler, build or declaration work ran.
- Git uses the exact Xcode executable/hash/size/mode/realpath plus explicit core
  realpath. This is not independent authentication of every Git-core file.
  S3 preserves caller PATH rather than injecting selector directories. Both npm
  routes use current Node plus exact54-byte CLI identity, preserving script argv
  and cwd; plugin helper copies env then deletes NODE_TEST_CONTEXT without mutating
  parent env. S3's existing intentionally finite env remains distinct. Neither
  helper alone qualifies Node identity, npm transitive imports or an arbitrary
  caller PATH. Those remain gate/external-closure prerequisites.
- Both search wrappers put explicit TAP before positional test files and retain
  status0 plus exact pass10/pass6 assertions. Wrong-output/nonzero/late-pass
  controls were prepared but did NOT execute. S3's top-level setup and later
  npm/build/pack/type/service flow likewise did not execute.

## Five-tool qualification

ROOT's exact five tool/libSystem ENOENT pairs are ratified as OS-METADATA ONLY;
the old pending proposal wording remains immutable historical data. No missing
image actual hash, actual caller/child identity, dyld runtime closure or unknown
image admission is claimed. Proposed18-to23 aliases add only cut/sort/tee/xargs/cat
at the exact user-named paths; no GNU substitute, version run or permission/PATH
directory widening is approved. Literal five G08 scripts and file inputs match
the inspected source; xargs's role is `-0 cat`, with space-bearing operands,
not arbitrary command dispatch. Tee filesystem-effect proof is not supplied by
the original stream-only comparison. Tool inspector bounds are source-inspected;
it was never executed/imported and its recorded image bytes were not re-read.

All20 prospective ACTUAL controls and all5 actual script replays remain UNRUN.
Even completed DATA/STUB controls could not have qualified actual identities;
here those independent controls did not start at all.

## Bindings and preservation

`BINDINGS.json` contains full refs,15 Git blobs and their committed manifest
SHA256 claims. Source manifest SHA
`47741f284b1593aa96b012d6e2ab9e9f6b64f38d69034b17554dc52544b59e71`;
tool profile SHA
`71ba31dea9594c3eee23c054a40b0fa09de4a78eb129a44018103c21a5dfb36c`.
These SHA claims are bound through immutable Git metadata, not independently
rehashed by the failed runner. Do not present the planned seal/hash controls as
executed. Protected author/reviewer live scoped diffs and status are empty;
their committed trees and the released R3 tree remain the recorded originals.
This checks new tracked/untracked entries in the four small author/reviewer roots,
not append-proofness or contents of the retained failed-run roots.

No broad scan,114MB capture rehash, retained-root cleanup or private read occurred.
928 captures/286 additions and19425P/132F/7skip/6-of-14 remain historical, bound,
not reexecuted or reverified root contents. All consumed releases remain consumed.
Signal/directory/socket/env-S causes and seven skips are untouched/unknown as
previously qualified. Expected c109 pack was not rebuilt.

Source437's entire src tree differs from f5 due to other history; selecting all
of437/HEAD would violate the proposed composition. Require f5 plus ONLY the13
explicit new fixture blobs in a NEW candidate; old632 bytes remain immutable.

## Finite next preparation, NOT GO

1. Author versions the minimal primary/cleanup precedence repair in owned helper
   paths. Preserve exact oracle inputs/env/namespace and source437 history.
2. ROOT assigns a new independent review version and fresh bounded DATA/STUB
   authority; retain v20's syntax failure. Fix its missing brace only in that new
   version and check syntax before sealing/executing the next authorized cohort.
3. Independently verify exact finite cross-realm data roles, primary identity,
   wrong-output/nonzero/late-pass and foreign-safe cleanup. Do not turn author45/17
   or planned53 into independent passes.
4. Only after fresh actual GO and exact tool/image/caller/fence admission: at most
   the5 unchanged G08 scripts once each,3s/16MiB per script, capturing xargs-to-cat
   route/argv and original statuses/bytes. ROOT must separately select any table71,
   compiler, Git/npm or reporter packet and its exact limits; no automatic bundle,
   version run, private setup or full-gate launch is authorized here.
