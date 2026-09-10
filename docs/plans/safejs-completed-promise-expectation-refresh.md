# Refresh completed imported Promise expectation

## Confirmed replay hang: supersedes the initial stale-test diagnosis

The stronger positive tests expose a real runtime gap, not merely an obsolete
assertion. All three completed dump routes time out while replaying a nested
settled Promise returned by an async host function. An isolated public diagnostic
completed the original run/dump/restore, but the replay remained pending after
1500ms with only 87.602ms process CPU and no second host invocation (82bcad).
This distinguishes the hang from the unrelated elapsed-time variability.

Probe: `/tmp/safejs-nested-host-promise-replay-probe.mts` against the allocation
candidate, whose replay runtime matches the committed settled-Promise repair.
Investigate PromiseReplay creation/settlement scheduling: the existing positive
tests cover nested Promises arriving through input-Promise settlements, not this
async host-return route. Keep the new main tests failing until the runtime is
fixed; do not commit them as a completed expectation-only repair.

Instrumentation confirms the scheduling discrepancy (6acd6c): original execution
tracks outer host-call Promise 1 and nested imported Promise 2 at step 5; replay
tracks only outer Promise 1. The replayed nested wrapper is restored with replay
tracking disabled. Preserve original creation/settlement order in a real fix;
do not bypass recorded events or assume every imported Promise was originally
created inside the active replay context. Direct input-Promise settlement routes
already pass and must not gain extra tracked IDs.

The main positive checks are now split across snapshot/result/execution dump
routes. All three still time out individually, proving the original combined-test
timeout was not merely due to test size. Main focused integration reports these
three hangs plus the unchanged 128-draw timing failure (175520).

Do not fix this by blindly enabling automatic tracking inside decodeReplayData:
host outcome decoding happens before its outer replay Promise is constructed,
which would reverse the original IDs. Deferring all nested registrations by one
microtask is also insufficient for delayed host outcomes interleaved with other
host calls. Validate explicit original tracking identity/order across concurrent
host calls, aliases and input-Promise routes, plus malformed metadata, before
choosing the restoration mechanism. The isolated scheduling prototype below is
not yet qualified for main.

## Isolated scheduling prototype follow-up

`/tmp/safejs-new-promise-capability.KGfWqD` now contains explicit imported-Promise
scheduling identities across the replay controller, wrapper factory, replay-data
codec and host journal. This directory is no longer a camera-only candidate.
No scheduling implementation has been copied into main.

The first public regressions reproduced failures for synchronous, asynchronous
and interleaved delayed host returns. The prototype passed those three cases,
nine existing input-settlement cases and 18 controller cases (30 total).

A fresh 19-test boundary run (57b3b9) then exposed two prototype bugs: an
imported-only replay never reported completion, and importing after an existing
controller failure left a Promise pending. Both were repaired in isolation by
advancing the restored-import counter and propagating the existing failure while
observing the supplied native Promise. The same run exposed a test error, not a
third runtime bug: an explicitly undefined scheduling ID is already rejected by
SnapshotValidationError before the codec's TypeError checks. Correct the expected
error class; do not change the validator to fix a hallucinated acceptance gap.

The ensuing five-file run passed all 49 tests (2fb53e, duration 16.53 seconds).
Its public host selection
contained the original three cases, not the two subsequently added cases.

The expanded host selection passed rejection replay but initially failed the
deeper-settlement test during original execution, before replay (1127d3).
The test incorrectly assumed identity across separate host calls. Current
copyHostResultToSandbox creates a fresh seen map for each result, consistent with
existing host-boundary copying controls. The revised test checks within-result
alias preservation and per-result isolation through repeated replay, without
changing the host boundary policy.

The corrected expanded host selection passed all five cases (d4b3d3, 9.80
seconds overall, 2.09 seconds in tests), including rejected settlements, deeper
settlements and repeated replay. This is focused prototype evidence, not main
integration or a full-package-green result.

Before main integration, validate malformed, removed, duplicate and unreachable
scheduling identities, including cross-graph aliases. The prototype currently
reserves IDs by scanning encoded nodes and has no independently validated
imported-ID ledger. These are unqualified design risks, not proven runtime fixes.
Also qualify cancellation, budget ownership, callbacks and legacy valid dumps,
then run lint, TypeScript, maintained build and the full package gate. Keep the
main completed-replay regressions uncommitted with the repair until qualified.

## Scheduling-metadata mutation qualification

An isolated constructor-level regression now proves that replacing a host
outcome root with null leaves an unreachable scheduled imported node accepted
(562eeb). The test uses a real completed public run/dump, changes only the graph
root, and asserts rejection before replay starts; it does not wait for a hang.

The prototype decoder's existing imported-wrapper notification now also reports
the optional scheduling identity. Journal validation gathers reachable IDs while
decoding all outcomes, then rejects scheduled nodes absent from that set before
reserving them. The original failing regression passed with the existing replay
and codec controls: 52 tests across six files (703e8b). Runtime TypeScript passed
with `npx tsc -p packages/safe-js/tsconfig.json --noEmit` (52c979).

The expanded five-case mutation selection subsequently passed unreachable,
out-of-range and duplicate checks, but failed removed-ID and outer-ID substitution
checks (f6c4e2). Both malformed graphs are still accepted by the journal
constructor. The test fixes the observed original nested ID at 2 before replacing
it with outer ID 1, so this is concrete evidence, not an inferred ID collision.
All tests and the repair remain isolated; these two failing controls must stay.

Next establish a validated relationship between the scheduling header and the
IDs emitted in host outcome graphs. Do not trust a mutable node field merely
because it is a positive number within the overall Promise count. Preserve
legacy valid input-settlement dumps without scheduling metadata, account for
serialization failure/rollback and cross-graph canonical references, and reject
missing or substituted identities before host execution. A second independent
ledger is a candidate mechanism, not yet implemented or qualified. The current
52-pass result predates the two newly added failing mutation checks and must not
be reported as an all-green prototype.

## Header/graph consistency prototype

The isolated controller now accepts an optional importedPromises ID list in its
replay header. Completed host-journal serialization records the emitted canonical
IDs only after the whole journal has successfully encoded and structured-cloned.
Journal reconstruction compares reachable graph IDs to the validated header
before reserving them. Missing, substituted, duplicate, out-of-range and
unreachable IDs now pass their rejection controls alongside public valid replay:
56 tests across six files passed (07e0b2). Runtime TypeScript passed (3e5f81).
This is structural consistency, not authentication against rewriting an entire
snapshot, and the prototype has not been integrated into main.

The header list is copied at both snapshot boundaries and its retained memory
is included in controller accounting, including subsequent Promise/callback
work. Header installation charges its allocation before changing controller
state. Additional controls for malformed headers, legacy absent metadata,
alias-safe snapshots, disposal, and allocation-failure rollback passed together
with existing host-call and public host-replay tests: 40 tests across four files
(bf6588). Neither run establishes full compatibility or full-package success.

The main three-route completed-replay regression was reproduced in the isolated
test file (not copied back to main). Broader callback/capability/replay selection
started as session 62874, and scoped ESLint as 16837. Collect their terminal
results before further implementation edits or integration. Main HEAD remains
bb19ffe81; all scheduling changes are still confined to the isolated directory.

The broader isolated selection completed successfully: 522 tests across 24
files, including completed dump routes, callbacks and capability behavior
(e6aeb1, 93.33 seconds). Scoped ESLint passed (011a1b).

## Main worktree integration

After reviewing each runtime diff against main, integrated the four scheduling
runtime files and five new regression files using apply_patch. The existing
main completed-replay regression is retained. No unrelated test/plan/staging
changes were included. Main source is now a candidate, not a committed delivery.

Focused main integration started as 32068; maintained selected-workspace build
started as 24923. Main scoped lint also started separately. Keep runtime source
fixed until these complete. Run the maintained full package gate on this actual
repair after prerequisite verification, preserving known remaining failures as
open work rather than asserting completeness. No push or release during hold.

Main focused integration ended with 60 passes and one failure (f5f1de). All new
regressions and the three formerly hanging dump routes passed. The unchanged
128-draw case hit its 5000ms timeout while build and lint ran concurrently. It
passed in the isolated 522-test selection, but that does not erase the main
failure or establish reliable full-suite timing. Keep this performance issue open.

The maintained main build completed successfully: 23 declared builds and all
five fresh-process built-import checks passed (36344c). Main scoped ESLint
passed (281faf), as did git diff --check. With those competing jobs terminal,
the completed-replay file is being rechecked once on unchanged source before
the local atomic commit and full package gate. No timeout or fixture reduction.

The unchanged completed-replay recheck still timed out on 128 draws after build
and lint had terminated: nine passed, one failed (6fa1a6). Therefore those two
competing jobs alone do not explain the timeout. Do not repeat unchanged reruns
to obtain a green result or call the timing issue resolved. Preserve the full
128-draw, three-replay coverage and investigate measured runtime cost separately.
The scheduling candidate remains uncommitted pending further qualification;
start the full maintained package gate with source frozen to identify remaining
failures while performance investigation proceeds in isolation.

Full maintained package gate started as session 64545 with `npm test
--workspace=@poe-code/safe-js -- --reporter=dot --reporter=json
--outputFile=/tmp/safejs-imported-scheduling-main-results.json`. The pretest stage
has started; neither its fs contracts nor unit results are yet claimed as passed.
Poll this handle to terminal and keep main runtime/tests fixed meanwhile. Do not
restart merely because a polling observation expires.

## Terminal scheduling integration gate

Gate 64545 is terminal (983ae4): all 100 fs contracts passed; units finished
with 28,712 passed, 21 failed and 47 skipped across 1,274 files in 1665.00 seconds.
The JSON numTotalTestSuites counts nested suites, not files; use the terminal
file count rather than reporting its 2069 suites as files. Report:
`/tmp/safejs-imported-scheduling-main-results.json`.

The 21 failures span eight files (58a650): 12 ISO/Temporal locale cases,
two native-Promise property admission cases, one 128-draw completed replay,
one full-trace camera batch, three generator-intrinsic cases and two CLI
filesystem cases. The CLI `--fs` case ran 5090ms; the next relative-root case
returned exit 1 instead of 0. The report does not expose its stderr, so the
second CLI failure's cause remains unproven. Several JSON messages contain
STACK_TRACE_ERROR rather than the original timeout text. Do not silently
attribute every reported failure to the same cause or omit the CLI assertion.

All new scheduling regressions passed. The full package is not green, and
neither camera reliability nor JavaScript completeness is established. Main
source is no longer frozen by this completed process. The separate disposal
and callback-name candidates remain isolated and must not be copied wholesale.

The following records the original hypothesis, now known to be incomplete.

## Atomic scheduling qualification

The independent disposal repair is now local commit d24dedde1. Its commit was
assembled from disposal-only hunks without replacing the working source; the
remaining host-call.ts diff contains only imported-Promise scheduling behavior.
The latest focused scheduling run passed all 42 tests across five files
(278a12). The combined main runtime also passed 34 disposal/callback/replay
tests (7fb8e8), the maintained 23-workspace build, and all five fresh-process
native imports (5078c7). Scoped scheduling lint is being rechecked before the
local scheduling commit. Earlier full-package failures remain open; these
focused results do not qualify camera timing or the 128-draw performance case.

The paragraphs below retain the earlier expectation-only hypothesis, not the
scope of the final runtime repair.

The scoped scheduling ESLint recheck passed (ccfcc2). Commit the four runtime
files, the completed-replay regression update, five scheduling test files and
this plan only. Publication remains held; local commit is not remote delivery.

The full integration gate and a focused main rerun (733d50) reproduce the same
stale negative assertion: run.completed-replay.test.ts expects an already-settled
nested imported Promise to make its completed snapshot non-replayable.
Local runtime commit 25f9bb944 intentionally added this capability.

Replace that negative table row with a positive regression covering direct
snapshot serialization, dump of the result and dump of the execution handle.
Each restore must produce the same value without calling the original host
loader again. Preserve the native-function rejection control separately; this
does not admit unsupported host functions or still-pending imported Promises.

Run the completed-replay and dedicated imported-settlement tests, lint the changed
file, and commit this test correction independently of the RegExp expectation
and camera work. No push or release during the hold.
