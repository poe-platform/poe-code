# Preserve intrinsic prototype parents across realms

Native VM and SDK comparisons reproduced wrong parent identity for Date, Map,
Set, RegExp, Number, Boolean, String, BigInt and Symbol prototypes. A budget-reuse
case also failed. The initial regression run had ten failures and nine passing
explicit-parent controls (36584).

A dynamic parent-lookup attempt fixed identity but made pristine Date values
fail existing data-copy checks (48928). That attempt was removed. The fix instead
initializes the object/array globals before other intrinsic factories, retaining
their existing position in the exported bindings, and stores the default parent
before each intrinsic prototype's baseline is captured. Explicit null or custom
parents remain untouched. No per-lookup fallback or additional realm registry is
needed.

The working-tree seven-file realm/prototype selection passes 54 tests (16047),
including the Date-copy regressions, replay, foreign inspection, explicit
overrides and budget reuse. This change is independent of the uncommitted weak
collections: the isolated candidate must contain only these initialization
changes, the regression file and this plan. Broader candidate validation remains
pending. No push or release is authorized.

The isolated 115-test selection found a snapshot regression (54293): restoring
a typed-array prototype mutation attempted to redefine String's nonconfigurable
`prototype` property. Direct constructor/prototype graph tests reproduced the
same error for Number, Boolean and String (90594: three failures, six passes).
The stored default parent made these pristine boxed prototypes look like guest
mutations, so serialization created distinct boxes instead of intrinsic nodes.

An owner-baseline lookup passed 78 focused tests (69694), but the broader run
still failed a Number.isNaN mutation snapshot (2197: 1,894 passed, one failed).
Six constructor/prototype mutation controls reproduced the remaining issue
(13805). That lookup was removed: guest-state detection must still recognize
mutated intrinsics.

Instead, heap capture excludes identified intrinsics from the generic boxed,
Date and RegExp branches. The existing intrinsic branch records their identity
and object state together, including mutations. The focused four-file selection
passes all 90 tests (38149), including pristine and mutated graph identities,
the Number.isNaN regression, private state and typed-array mutations. Broader
isolated-candidate validation remains required before committing.

The isolated candidate passes the complete snapshot directory and twelve
realm/intrinsic test files: 1,873 tests across 141 files (70047). All 1,323 tracked
SafeJS source/test blobs match staged tree
`72172449a002cc4e4679ec50bb3c8d09be006add`; unfinished weak-reference changes
are excluded. Candidate type checking passes (85889), and the maintained
selected workspace build passes all 23 build tasks and four native ESM import
checks (1410). Focused lint passes (98342). The full package unit gate is running
on that same source/test tree (46858); do not commit until its terminal result
and post-run source verification are available.

The full run (46858) terminated with 25,018 passes, three failures and 37 skips
across 989 files. All 1,323 source/test blobs still matched after completion.
Two camera batches exceeded the existing 5000 ms timeout. The retained-root
async case exceeded its fixed data-size ceiling (926 > 500). A focused repeat
(31078) passed all camera cases but reproduced the accounting failure; the
camera timeout remains unresolved, not dismissed as a successful full gate.

Measured async peaks are 626 without an added string, 926 with 300 characters,
and 1,226 with 600 (f1503d). The originating prototype links are now part of
the retained graph; added roots are charged exactly once. The closure-accounting
test compares 300-character and 600-character registered roots, derives its
ceiling from the former execution's peak plus 300, asserts the exact peak, and
proves rejection at one unit below that ceiling. Empty-root baselines failed
for the arrow case (15316, 13011): the initial realm setup peak dominated the
smaller execution. Nonempty paired roots exercise the same accounting path.
The corrected test and prototype regression file pass all 57 cases (36198).
This strengthens the accounting invariant instead of selecting a larger fixed
number. Camera performance and renewed full-package validation remain pending.

Nine read-only built-runtime controls (c19df8) also preserve private fields
stamped onto Number, Boolean and String prototypes, plus explicit null/custom
prototype parents, through low-level heap restoration. These checks support
the intrinsic encoding change without treating generic boxed instances as
intrinsics. They do not cover mixed-realm transport; that separately reproduced
gap is recorded in `safejs-mixed-realm-snapshot-identity.md`.

A fresh built-runtime profile of the first inverse-coordinate batch preserved
normalized native output in three runs (92076). Wall times were 3,227/4,792/3,481
ms; process CPU times were 1,674/1,622/1,434 ms. Largest sampled self totals were
the data visitor (4,862 ms), GC (1,096 ms), and intrinsic retention callback
(867 ms). Samples include scheduling delay and are not CPU benchmarks. No
optimization, timeout increase or fixture reduction follows from these figures.

## Rebased candidate after builtin metadata fixes

The unchanged main-tree camera and accounting selection passed all 22 tests
(63958), without establishing a full-suite timeout fix. No further optimization
was justified by reviewing the existing profiles and rejected experiments.

The isolated candidate is now rebased onto `3cc2afd34`, including the committed
buffer replay, parser identity and builtin-length repairs. Its staged tree is
`767c040809fe0b42aa73e7f727f599fe321df8e6`; all 1,281 tracked SafeJS source blobs
match the private index (e808bb). Pending weak-reference edits remain excluded.
Prototype, accounting and unchanged camera tests passed all 68 cases (10621).
The maintained selected build passed 23 tasks and four native ESM imports
(27915). A fresh full package run uses `npm test --workspace=@poe-code/safe-js`,
including its native pretest step. Await its terminal result before committing;
do not treat focused camera passes as resolution of the earlier full-suite issue.

Full run 19850 finished with 25,089 passes, three failures and 37 skips across
993 files (702.79 seconds). Camera and corrected accounting tests passed in
this run. Two historical checkpoint graph checks require `["parseInt"]` while
the shared parser now has canonical identity `["Number","parseInt"]`; inspect
the legacy graph comparator before changing runtime identity semantics. The
third failure is `Atomic replay stalled` from a 100 ms observation guard in
`atomics-wait-async.test.ts`. A focused repeat is required to distinguish
reproducible replay defects from timing sensitivity. This is not a green gate.
All 1,281 tracked source blobs still match the candidate index after the run;
an initial fingerprint command had a syntax typo and was rerun successfully.

Focused repeat 58753 passed 48 tests, failed the same two historical parser-path
checks and skipped one. All Atomics wait tests passed in isolation; the 100 ms
full-run failure remains unresolved, not dismissed. The next comparator change
must verify the global and Number parser aliases reference the same heap node,
not broadly ignore intrinsic paths or weaken unrelated graph identity checks.

## Verification after resolving the full-run failures

The legacy parser comparison is committed as `0887bdcd3`, with all existing
helper tests preserved and exact alias checks added. The timing-sensitive
pending atomic replay case is committed as `78b4c7842`: worker registration is
controlled in the unit test, native waits/notifications are retained, and real
worker disposal coverage remains separate. Neither change modifies production
runtime behavior or increases a timeout.

The prototype candidate is rebased onto `78b4c7842`, staged tree
`463a038a9e9afbc9c812db4ea286506d7347ff1d`. All 1,328 tracked SafeJS source and
test blobs match the private index (cf70bd). This check includes the test helper
directory as well as `src`; weak-reference integration remains excluded.
Scoped lint passed the five prototype/accounting source and test files (67265).
A renewed full package gate now uses `npm test --workspace=@poe-code/safe-js`.
No candidate source changes are permitted during the run.

Run 94735 terminated with 25,099 passes, one failure and 37 skips across 994
files in 668.16 seconds. The historical parser checks, controlled Atomics replay
and camera tests passed. The remaining failure is the Bundler + DOM case in
`modules/fs.type-contract.test.ts`, which exceeded the unchanged 5,000 ms limit.
All 1,328 tracked source/test blobs still matched after the run (b45e44).
This remains a failed full gate; inspect the type-contract compiler workload
and reproduce before changing its checks or runtime code.

Focused repeat 96947 passed all four NodeNext/Bundler × Node-only/DOM cases
in 3.08 seconds of test execution (3.42 seconds overall). Each case constructs
a fresh TypeScript program and checks all pre-emit diagnostics, including
libraries with `skipLibCheck: false`. No assertion, compiler option or timeout
has been changed; the full-run timeout remains unresolved.

## Current-main requalification

The compiler matrix move is now committed as `4c78ee6b6`, preserving all 100
checks in maintained pretest hooks. A later full prototype candidate run,
53012, passed those compiler checks but reported 25,092 runtime passes, six
5,000 ms timeouts and 37 skips. The six cases cover PPR2, namespace identity,
camera transforms and foreign RegExp construction; all four affected files
passed unchanged in focused run 9193 (183 tests). These timing failures remain
open, not reclassified as passing full-suite evidence.

The six-file prototype candidate is now rebased onto `4c78ee6b6`, staged tree
`812522d75ad24ddcb6ba14986ec7d2c4aba005e5`. Inspection confirms globals.ts changes
only Object/Array initialization order, guest-heap.ts changes only intrinsic
encoding precedence, and object-model.ts stores the original parent before
intrinsic registration. The exact paired accounting control and prototype
tests are included; pending weak-reference integration remains excluded.

Build 32016 was inadvertently launched in the main worktree after candidate
checkout. Do not count it as isolated qualification or reuse its SafeJS output
as the candidate artifact. A separate build in the isolated directory is
required before its focused and full-package verification. No source changes
are permitted during those runs.

The intended isolated build 93991 passed all 23 selected dependency tasks and
four fresh native ESM import checks. All 1,332 tracked source/test/script/
manifest blobs match the private index (545404). The next focused selection
combines the full snapshot test directory with 73 realm/prototype/accounting
files, including the foreign-newTarget controls. The earlier main-worktree
build also passed, but remains excluded from this candidate's qualification.

Focused run 41146 completed successfully: 3,121 tests across 203 files passed
in 199.46 seconds. This covers the complete snapshot directory and the selected
realm/prototype/accounting files, not the full package. The previous full-run
timeouts remain unresolved. A fresh isolated lint check and full-package gate
are still required; no push or release follows from this focused result.

Post-test verification 58b4cd confirms all 1,332 selected source/test/script/
manifest blobs still match the private index. The real index retains the user's
three SafeBash paths unchanged (stable patch ID
`5aef205cd9aba8165a9884b97907573239bdeb26`). Inspection of the installed Vitest
implementation confirms `logHeapUsage` only samples `process.memoryUsage()`
after tasks/suites; it does not request garbage collection. The next maintained
full-package run can add that flag and the verbose reporter for timing/memory
evidence while preserving the existing worker count, limits and assertions.

Isolated scoped ESLint run 62524 terminated successfully (6d23bb). The fresh
maintained full-package command is now `npm test --workspace=@poe-code/safe-js
-- --logHeapUsage --reporter=verbose`, with diagnostic output retained outside
the repository. Its result is pending; the candidate remains uncommitted.

Full session 55216 has passed all four 25-case compiler matrices but has already
reproduced two runtime timeouts: the MC-002 1,800-step/two-call checkpoint
(5,321 ms, 337 MB reported heap), and a complete inverse-camera batch
(5,512 ms, 200 MB). Both exceed the existing 5,000 ms guard. This is not a green
gate even if subsequent cases pass; await the terminal count before follow-up.
The diagnostic log also contains passing regex cases with 976 MB reported
heap. These per-task observations do not establish a leak, GC causality or
that either timed-out test had the largest heap. No candidate input, limit,
assertion, worker count or test selection was changed during this run.

Session 55216 terminated with exactly those two timeouts: 25,100 passed,
37 skipped, 994 files, 834.13 seconds (8ae119). All 1,332 tracked candidate
blobs still match the original private index (37e2ec). The additional visible
files are the eight NumberFormat/PluralRules artifacts generated by the native
pretest script in `src/intl-data/dist`; they are not additional test inputs.
Main has advanced through documentation-only commits a480265ca and b6501e375;
rebase the private commit index before eventual delivery, without attributing
those later documentation changes to this frozen test run.

All eight generated Intl artifacts match their fresh selected-build copies
byte for byte (71667f). Focused follow-up 56038 passed all 29 tests in the two
affected files, in 13.48 seconds, with their original assertions and 5,000 ms
timeouts intact. This confirms focused success, not full-suite qualification;
the prototype fix remains uncommitted while timing reliability is unresolved.

Main subsequently gained concat implementation commit `2fa89c3c6`, qualified
independently without the prototype fix. The old prototype private index is
therefore stale against a runtime change as well as documentation changes.
Rebase only the owned prototype/accounting edits onto current HEAD before any
future candidate commit; do not overwrite the newer iterator implementation.

## Requalification after joint iteration and consumer budgets

Main is now `6ef11daa2`, following independently qualified joint iteration
`1f8b80b7b` and the consumer output-budget fix. A fresh read-only probe against
that committed built candidate (a2aeec) still reports
`datePrototypeKeepsOriginalParent: false` when another realm inspects an
exported Date prototype. The underlying prototype issue therefore remains
validated on current committed code.

Rebase the six-file prototype patch using its old `4c78ee6b6` base onto the
current HEAD, retaining the stronger paired accounting checks and excluding
uncommitted weak-reference integration. Candidate location:
`/tmp/safejs-prototype-current.iGitfF/candidate`. The earlier full-suite
timeouts remain open until this current candidate is qualified; old focused
passes are not a new full-package result.

Current export 96928 completed with the six-file staged tree
`42cf96fc7ef5cbf853f8d52d9216e99dee09e28d`; fingerprint f2dbca verified all
1,339 source/test/script/package blobs. Build 70199 passed all 23 selected
build tasks and four fresh-process native ESM imports. Scoped ESLint 73510
also completed successfully. Built Node 18.18.2 check 49939 passed foreign
parent inspection for all nine affected intrinsic prototypes. Post-build
fingerprint 4e58a9 matched all 1,339 blobs plus eight generated Intl copies,
with no unexpected source/test/script files.

Maintained full package session 47088 is now running with `--logHeapUsage
--reporter=verbose`, preserving the pretest compiler matrices and normal
worker count/timeouts. Log:
`/tmp/safejs-prototype-current.iGitfF/full-package.log`. Do not restart or
change this frozen candidate while it runs. Its result is pending; the older
timeouts are not yet resolved, and this candidate remains uncommitted.

Current full run 47088 has reproduced timing failures, not a green gate:
the final camera guest batch took 6,255 ms at 270 MB reported heap, and the
PPR2 `'co'` fresh-writer continuation took 5,195 ms at 365 MB. The former
namespace 1,800-step/two-call checkpoint passed at 1,766 ms, 342 MB. Do not
infer GC causality or a fixed timing issue from these per-task samples.

The camera's parameterized case names are truncated to the same visible
prefix in the log. In declared batch order, its eighth/final guest case is
`inverse-coordinate-transforms:camera-offset-handoff-typed:samples-2-3`:
the fixture contains 6, 5 and 4 points across its three cases, batched by two.
Read-only fixture/log check b2471c confirms the seven preceding guest batches
passed and the final one timed out. Wait for the current run's terminal
result, then profile the affected cases without changing assertion coverage,
timeouts, worker count or the frozen candidate during execution.

## Terminal gate and exact-fixture diagnostics

Full package session 47088 completed unsuccessfully: 25,180 passed, three
failed, 37 skipped; 996 files passed, three failed, one skipped. Duration was
1,081.73 seconds. Besides the two 5,000 ms timeouts above, the adversarial
corpus exceeded its internal 750 ms limit at 1,164.1 ms. Its terminal error
reports elapsed-time enforcement, not a failed semantic or resource assertion.
This is not evidence of a new iterator array-budget regression.

After the full run terminated, focused session 25308 reran the unchanged
camera, PPR2 adjudication and adversarial corpus files on the same isolated
candidate. All 31 tests in three files passed in 24.94 seconds. No timeout,
worker setting, fixture, assertion or resource budget was changed. This focused
pass does not qualify the failed full-package gate.

Built-runtime diagnostics ran sequentially, without concurrent full tests:

- Camera final batch source SHA-256:
  `099ee3123de6467d640046656b2fbe28d6de59a87aa473a00301ff67545b52de`.
  Sessions 10186 and 83478 preserved seed 827, all original resource limits,
  complete native output and recorded trace comparisons. They passed at
  2,111.09/2,398.11 ms wall and 2,035.72/2,126.08 ms process CPU. Peak data
  size was 5,412. The measurement visitor accounted for approximately
  963/1,053 ms sampled self time; intrinsic retention approximately 147/189 ms.
- PPR2 `co` source SHA-256:
  `246a419fb5a2e0854e0850f3285b4972eeefaab54849f7306b5872f267a7a7bc`.
  Session 34171 passed native trace, pending public/signal captures, completion,
  all three restore/resume/recapture/final-replay paths and receipt/call checks.
  Process CPU was 2,995.95 ms; measurement visitor sampled self time was
  approximately 1,025 ms, intrinsic retention 143 ms and GC 147 ms.

The first camera diagnostic (45761) used prototype-sensitive Node strict
equality on intentionally null-prototype exported records and failed. Only the
diagnostic was corrected: structured cloning normalizes exported record
prototypes before strict native comparison, retaining exact numeric values;
the recorded JSON comparison is separate. Repository tests were untouched.

Statement-position samples from the second camera profile locate symbol
enumeration/filtering, record key enumeration and array/record descriptor reads
inside the visitor. These are samples, not operation counts or proof of
redundant work. Any optimization must retain mutation visibility, proxy traps,
accessor safety, graph alias accounting and capture-before-callback ordering.
Do not repeat the previously rejected early closure-dispatch experiment merely
because the visitor remains hot. No runtime fix or full-gate success is claimed.
The prototype candidate remains uncommitted and publication remains on hold.

## Current integration after continuation-reference validation

Current HEAD d328f1a4c already includes the Object/Array initialization ordering.
The remaining runtime correction stores each original intrinsic parent before
registration and gives identified intrinsics precedence over generic boxed,
Date and RegExp heap capture. Weak-reference heap edits are excluded from this
atomic commit. The paired retained-root assertions and all 46 prototype/graph
regressions belong with this correction.

Fresh current-tree runs pass all 57 prototype/accounting tests on Node 22.23.2
(de96f5) and Node 18.20.8 (e0c566). The complete snapshot directory also passed
2,080 tests across 152 files after the continuation-reference change (06aaa6);
it includes this pending intrinsic capture correction. Earlier isolated
qualification and original failing controls remain documented above.

The most recent full package gate has ten failures, recorded in
safejs-post-temporal-full-gate.md. None is a prototype identity or retained-root
assertion failure. This integration does not claim those failures fixed or
supersede the failed package result. Keep publication on hold and continue
addressing the remaining verified failures after the local atomic commit.

Fresh focused ESLint (05eb54) and package TypeScript checking (6774e1) both
pass. The private commit index contains only six prototype/accounting/docs
paths; its guest-heap change is the single intrinsic-precedence condition.
