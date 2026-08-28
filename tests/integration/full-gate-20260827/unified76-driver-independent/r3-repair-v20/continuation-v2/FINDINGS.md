# Findings — HOLD, no further execution

The single syntax-only continuation retains four independently demonstrated
source failures and two newly observed reviewer harness failures. Nothing here
repairs an author file, changes an assertion, or authorizes another attempt.
All source anchors below refer to immutable
`437778996f60109e212e20b1b242455866fda285`, verified equal before and after.

## F01: primary reasons lost during owned cleanup

The original identity assertion is strict reference comparison (`actual !==
expected` at review.mjs:116), not deep equality of cross-realm Error prototypes.
Raw JSON records messages, not object references; the executed assertion proves
loss of the supplied primary object. `memory().remove()` throws the supplied
`rmError` object directly. Cleanup-only separately checks that cleanup object's
identity. Do not mistake identical messages alone for identity evidence.

### Table helper — executed counterexample

`tests/commands/table-text-stress/support.ts:67` begins the finalizer; line68
awaits `rm(cwd, { recursive: true })`. Original native work starts at53 and the
first sentinel write is56. T02-primary-plus-cleanup injects distinct objects
`PRIMARY-primary-plus-cleanup` at the recording spawn and
`CLEANUP-primary-plus-cleanup` at removal. The same complete source module runs
with synthetic FS/process dependencies. The strict primary-identity assertion
fails; observed reason is the cleanup error. Removal was attempted once, the
failed fake root `/gate/tmp/safe-bash-table-native-S1` remains, and the ordinary
foreign canary is unchanged. No real root was acquired or deleted.

Relevant controls are preserved, not promoted to native proof:
- T02-write: first sentinel write throws its primary object; cleanup is attempted,
  root disappears, original primary identity is preserved, foreign canary survives.
- T02-spawn: primary-only spawn throw similarly preserves identity after cleanup.
- T02-cleanup-only: exact cleanup reason identity surfaces; no false success.
- T02-late-cleanup: settlement stays pending while synthetic rm is held, then
  completes after release and removes the owned root.
- T01: all71 unchanged fixture argv/input/locale/PATH/file assertions traverse
  the actual helper with recording dispatch. This is one STUB control with71
  fake dispatches and zero native semantic passes, not71 native passes.

The original53 do NOT combine sentinel-write failure and cleanup failure in one
control. The source finalizer can mask that primary too, but it is a static
counterexample, not an executed combination. No such control was added now.

### Shared helper — executed native-call counterexample, version static-only

`tests/commands/table-text-stress/shared-stdin-fix/support.ts:86` begins native
cleanup; sentinel verification is88, child rm90, outer parent rmdir93. The
version-query finalizer is59-60. These precise line anchors correct PRESEAL.md's
inaccurate shorthand for the sentinel/child lines; its frozen bytes are retained.

T03-shared-primary-plus-foreign throws `SHARED-PRIMARY` at recording spawn. Both
owned cleanup operations are attempted in order:
1. recursive rm `/gate/tmp/safe-bash-table-shared-S1/native-S2`;
2. nonrecursive rmdir `/gate/tmp/safe-bash-table-shared-S1`.

The second refuses because the synthetic ordinary foreign sibling is present.
It throws the fake rmdir's `ENOTEMPTY` reason, message `nonempty owned parent`,
which replaces `SHARED-PRIMARY`. The strict identity assertion fails. The sibling
is retained and there is no recursive parent removal. T03-shared-foreign-parent
separately asserts ENOTEMPTY, while success and child-acquisition-failure controls
pass. Acquisition failure preserves the primary and attempts only parent rmdir.

Static-only additional paths: verifyOracle's finally can replace a read/hash/
version failure with parent-rmdir failure; native's sentinel read/assertion and
child rm can each mask an earlier primary before the outer rmdir. verifyOracle
was NOT invoked here. Do not equate this finding with a native version failure
or with mount's separately managed node:test after-hook aggregation.

### GNU scratch helper — executed counterexample

`tests/commands/diff-patch-stress/gnu-target/oracle.ts:15` calls the callback;
line16 performs finally rmSync. P01-patch-scratch-primary-plus-cleanup throws
`PATCH-PRIMARY` from that callback and `PATCH-CLEANUP` from the fake removal.
One owned cleanup attempt occurs; the primary identity check fails with the
cleanup reason observed. Primary-only, ordinary success, and outside-root refusal
controls pass; the outside-root case never invokes the callback or acquires a
fake scratch directory. The ordinary foreign canary is checked before identity.

The same helper wraps oracleIdentity and the auxiliary/followup native callsites;
those callsites are source-only here, not actual identity probes or patch runs.

### Shell helper — executed counterexample

`tests/shell-stress/helpers.ts:105` begins nested cleanup; rmSync of semantic
directory is106 and separate scratch removal is107. H01-shell-primary-plus-cleanup
injects `SHELL-PRIMARY` in isolatedSpawn and `SHELL-CLEANUP` for each fake rm.
Both removals are attempted, in order:
`/gate/tmp/virtual-bash-shell-stress-S1`, then
`/gate/tmp/safe-bash-shell-scratch-S2`. The observed escaping reason is
`SHELL-CLEANUP`, not the primary object. The two removals share the same injected
cleanup object, so this is not proof about ordering of two distinct cleanup
reasons. Foreign canary survives. The success control keeps the ordinary
`sh-thd-ordinary` semantic file visible and excludes the separate scratch-only
file; no semantic-name filtering or native Bash execution occurs.

### Stream helper — source finding only, attempted controls harness-blocked

`tests/commands/stream-inspection/oracle.ts:38` begins nested cleanup; line39
removes the semantic folder and40 removes separate scratch. If capture's body
throws a primary and either rmSync throws, that cleanup throw can replace the
primary; a second cleanup failure can also replace the first. This is a static
language/control-flow finding at the immutable source, NOT an executed stream
counterexample in this continuation. Both original H02 controls failed during
module linking before capture() or any stream fake acquisition/dispatch ran.

## H01: unexpected stream import admission failure

Both H02-stream-success and H02-stream-primary-plus-cleanup returned raw FAIL
with `AssertionError: undeclared import ./helpers.js`. The bound source imports
`{ type Fixture } from "./helpers.js"` at line9. The actual Node type-strip/link
path still requested that module. The original loader's exportsByModule lacks
the specifier and asserts at review.mjs:216 before constructing a synthetic
dependency. There is no fallback real loader and no real helper import.

The preseal administrative regex incorrectly classified that whole import as
erased. This is a reviewer admission defect, not an author/product failure.
PRESEAL.json's erasedTypeOnlyImports classification for this path, and its broad
claim that all bound imports had been admitted, are therefore falsified by the
actual link receipt. Preserve that preseal, do not silently edit it. Failed
transformed source text was not captured, so no exact transformed-text claim is
made. No additional strip, parse, module load or subject replay is performed.

The raw collector reports6 FAIL /0 HARNESS_ERROR because its unknown-import
assertion has no `harness` marker. Correct evidence classification is4 source
FAIL plus2 harness errors, with the two intended stream operations UNEXECUTED.
This is a provenance correction in new evidence, not altered raw results or
weakened assertions. Results retain all original53 planned IDs and roles.

## H02: fatal-stop requirement was not satisfied

Unchanged check() at108-112 catches every operation exception and appends a
result; it does not rethrow harness-marked or import-admission errors. Therefore
the unexpected failure at ordinal31 did NOT stop the sole running process.
Ordinal32 also fails linking; ordinals33-53 yield21 raw PASS results. There was
no manual retry or second cohort command, but this behavior violates the requested
fatal-stop discipline. The first30 rows contain26 PASS and4 source FAIL. The22
rows after the first refusal are retained as observed, not qualified as an
authorized fail-fast continuation. Nonzero exit1 survives the final D03 PASS.

No unsafe import executed; the route itself refused. That does not excuse the
collector's failure to stop. The raw summary is not a conforming full53 green
review. A separately authorized version is required for any harness correction.
No source, import allowlist, comparator, assertion or collector fix is made here.

## Minimal author-only repair direction — not implementation authority

At the five fixture/helper cleanup boundaries above, preserve an explicit
`hasPrimary` flag separately from the thrown value, attempt and await every
owned cleanup, and retain secondary cleanup diagnostics without replacing the
primary. Rethrow the original value unchanged, including undefined, null,
non-Error/frozen objects and primitives. Do not mutate thrown objects, coerce
reasons, deep-compare cross-realm prototypes, suppress ENOTEMPTY, skip later
cleanup, return late success, or recursively remove the shared parent.

If no primary exists, cleanup failure must still escape rather than report
success. The representation/ordering of secondary diagnostics needs an explicit
author contract; this review does not invent one or require a product API change.
Identity-only success cannot be inferred for arbitrary values: unchanged caught()
at114 maps both normal completion and throw undefined to undefined. The53 controls
do not cover that distinction, sentinel-plus-cleanup together, every shared
cleanup branch, two distinct cleanup reasons, or stream capture after admission.
Those gaps stay unexecuted, not waived or patched within syntax-only scope.

Some masking predates source437. These are current immutable-source findings,
not attribution of all historical132 failures, native failure-cause diagnosis,
evidence of a repaired old cohort, or GO for product/native/compiler/gate work.
