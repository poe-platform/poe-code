# Frozen dynamic-function candidate validation

## Integrated follow-up verification

Session 11849 terminated with exit 143 during the full unit route, without a
final Vitest summary. All 23 maintained builds and four fresh import checks
passed. Failure markers appeared during the unit run, but no authoritative
final counts or failure details were produced; the termination cause is not
established. No matching Vitest process remained in the subsequent process
check. This is not a completed or passing unit gate. The 1,163-file package
snapshot exactly matches the current source, excluding node_modules, dist and
coverage directories. Its sorted manifest digest is
`65b50da011daf3bf1e298841d0a4e41ea543d501a6d9a28141a22e0edccfe2bd`.
The copy and manifest check completed while prerequisite builds were running,
before the SafeJS build began. The post-termination manifest exactly matches
the original 1,163 files and digest; the candidate remained frozen.

This snapshot includes the later numeric-update and default-parameter eval
repairs, the independently committed function/arguments/Array intrinsic changes,
and the final host-version-independent Array descriptor tests. Experimental weak
collections and both unresolved host-Promise property-import tests remain in
scope. Later eval/super tests and the eval block-function deletion fix are
outside this snapshot. No push or release is authorized.

## Latest eval-deletion verification

Session 89782 completed with exit 1: 22,718 passed, two failed and 37 skipped
across 829 files (827 passed, one failed, one skipped), taking 678.45s. Both
failures are the same native string/user-symbol Promise property-import cases.
The maintained SafeJS build closure and all four fresh import checks passed.
The refreshed package snapshot includes the locally
committed ReferenceError stack repair and the later uncommitted eval-binding
deletion, resolved assignment and destructuring/recovery fixes. All 1,156 package
files match the source tree, with zero missing, extra or different files, excluding
directories named node_modules, dist and coverage. SHA-256 of the JSON-encoded
sorted [relative path, file SHA-256] manifest (localeCompare path ordering):
`c46ea705025e7a10c22b5154f3d270acdd84c11b8f673cc418dddce8041c92d5`.

The candidate remained frozen through termination: the post-run 1,156-file
manifest matches the recorded digest exactly. Root infrastructure and private
dependencies remain the isolated baseline. Experimental weak collections and the
two unresolved host-Promise property-import tests are still present; this run
does not authorize publishing them or copying private native metadata. Latest
focused deletion/assignment validation passes 342 tests and final TypeScript/lint.
The later numeric-update and parameter-environment repairs/tests, plus the
constructor-independent rewrite of the function-restriction tests, are outside
this snapshot. This is not a green full gate. No push or release.

## New whole-SafeJS verification

Session 31057 is terminal, exit 1: 22,682 passed, two failed, 37 skipped across
823 files, taking 833.61s. This refreshed snapshot includes the later
exception-block, ReferenceError recovery, empty-retention and explicit eval
checkpoint-expectation changes. Both remaining failures are in
interp/promise-import-properties.test.ts: native string and user-symbol property
imports. The earlier workload deadlines and historical checkpoint expectation
failures did not recur in this run. This is still not a successful full gate.

All 1,150 package files match the main worktree, excluding node_modules, dist
and coverage, with no missing or extra files. SHA-256 of the JSON-encoded sorted
[relative path, file SHA-256] manifest:
`cbdf51201c49f4d7d98d93522512799d4bc59bdc9fe8500e43496ad3475dbdf5`.
Dependencies and root workspace infrastructure remain the isolated baseline.
The snapshot stayed frozen through termination. Three later function-identity
recovery matrix cases were checked separately and are not part of this run.
No push or release.

The maintained 23-build closure and all four fresh-process import checks pass.
The entire unit suite completed with the result above. The host-promise property
policy remains unresolved: automatic copying risks importing private Node async
context data. An explicit property-allowlist option versus settlement-only imports
has been presented to the user; do not silently copy arbitrary native symbols.

## Completed whole-SafeJS snapshot

A new full run, session 94065, uses a fresh snapshot of the entire current
SafeJS package in the existing isolated checkout. Unlike previous runs, this
includes eval, later async-function work, weak-collection and other experimental
SafeJS changes. It is not the earlier reduced dynamic-function candidate.

The source and isolated package each contain 1,143 files excluding node_modules,
dist and coverage. Every relative path and SHA-256 matches, with no extra files.
The sorted name/hash manifest digest is
`2a07136a121304d806d1057dd5d4b32d073661a5265d492c95bdbde9e4c115e2`.
Dependencies and workspace infrastructure remain the isolated checkout's
baseline; unrelated staged SafeBash work was not copied or modified.

Command: `npm run build:workspaces -- --workspace=@poe-code/safe-js && npm run test:unit --workspace=@poe-code/safe-js`.
Session 94065 is terminal, exit 1: 22,631 passed, 10 failed, 37 skipped across
816 files, taking 924.23s. The maintained 23-build closure and four fresh-process
import checks passed. This is not a successful gate. Later exception-block and
ReferenceError work in the main checkout is outside this frozen snapshot.

Failures requiring followup without relaxing assertions, budgets or deadlines:

- Three external-checkpoint cases: callback, retry-reissue and co (5000ms).
- Completed replay at 128 draws (5000ms).
- Both complete D3 bisector function-arity workloads (deadline budget).
- Two host-Promise own-property import cases (missing string/symbol properties).
- Math f16round and regex historical checkpoint graph checks: the expected
  intrinsic additions omit eval, which is present in the actual restored graph.

Continue local implementation separately; no push or release.

## Earlier reduced-candidate runs

The fifth run is terminal: 22,266 passed, one failed, 37 skipped across 787
files, taking 915.34s. Its 23-build closure and four import checks passed. The
corrected array-context test passes in the full run. The sole failure is now
the unchanged MC-002 test that preserves aliases through three completed
object-registry replays, exceeding 5000ms. Isolate and profile that exact case
without relaxing assertions, deadlines or concurrency. Eval remains excluded.

The fourth run is now terminal: 22,266 passed, one failed and 37 skipped
across 787 files (785 passed, one failed, one skipped), taking 806.01s.
Its maintained 23-build closure and all four import checks passed. The sole
failure is the new array-write-context regression: guest setters produce the
correct values and receivers, but the partial module mock records zero calls.
The same failure reproduces in isolation in the main checkout. Do not change
runtime behavior or weaken the assertions to work around an instrumentation
failure. A post-import spy and an explicit context-allocation mutation check
are being validated. Earlier namespace and timing failures did not recur.
This is still not a green complete gate. Eval and async-function-tag followups
remain outside this completed candidate.

A fourth run has now started after deliberate synchronization of the later
symbol/descriptor fixes: accessors.ts, globals/function.ts, globals/object-array.ts,
globals/object.ts, globals/reflect.ts and promise.ts, plus ten native/snapshot
regression files for unscopables, restricted function accessors, strict arguments
descriptors, Promise tags and deleted collection/typed-array tags. Every transferred
file was byte-compared with main. The weak-collection and host-Promise experiments
remain excluded. Keep this refreshed candidate frozen through its maintained
selected-workspace build and entire SafeJS unit run.

The third candidate run is now terminal: 22,217 passed, one failed and 37
skipped across 777 files (775 passed, one failed, one skipped), taking 976.93s.
Its 23-build closure and four import checks passed. The sole failure is the
MC-002 namespace-identity original graph test with object/object registries,
which exceeded the unchanged 5000ms test limit. The earlier camera, PPR2,
checkpoint and historical replay failures did not recur in this run. This is
not a green full suite or proof of reliable timing headroom.

This completed candidate includes the synchronized grammar, self-binding and
array-context followups below, but not later unscopables, restricted function/
arguments descriptors, or Promise toStringTag changes. Isolate the remaining
namespace test without changing fixtures, assertions or deadlines.

Its isolated namespace file subsequently passes all 18 tests, taking 26.18s
of test time (33.02s overall). No assertion, source byte, budget or timeout was
changed. This does not turn the failed full run into a pass or establish a
functional defect to repair. The namespace timeout remains a reliability gap.

Followup synchronization after that terminal run: five current implementation
files (parser, interpreter, async, scope and patterns) and nine new regression
files were copied into the isolated candidate and byte-compared with main.
These cover loop var conflicts, for-in sequences, for-of let lookahead, named
function self-bindings, repeated non-strict block functions and array-context
reuse. The identifier-read microtask repair is included. The two heap files
received only the named-function silentImmutable cell type/validation changes;
experimental weak-collection hunks remain excluded. Focused tests, TypeScript
and lint are checked separately from a new maintained full candidate run.
All 130 focused tests across eleven files, TypeScript and focused lint pass.
A new maintained selected-workspace build followed by the
entire SafeJS unit suite has started; keep this candidate frozen until that
process terminates. This run includes the synchronized followups above.

The new run's maintained 23-build closure and all four fresh-process import
checks passed; the full SafeJS unit process is active. A later main-tree
Array.prototype Symbol.unscopables repair is deliberately outside this frozen
candidate; see safejs-array-unscopables.md for its reproduced failure and
focused validation. Do not attribute that later fix to this whole-suite run.
The subsequent restricted Function.prototype caller/arguments accessor repair
is also main-only, with 114 focused checks plus TypeScript/lint passing; see
safejs-function-restricted-accessors.md. Keep both out of the active candidate.
The strict arguments descriptor bridge is a third later followup outside this
run. It changes accessors.ts and Object/Reflect descriptor exposure, and adds a
stable throwing-intrinsic registry alias; see safejs-arguments-restricted-descriptor.md.

The previous complete result below remains the last whole-suite evidence;
later focused passes do not overwrite it.

Concurrent read-only syntax audit found no mismatch in six native catch/var
cases (simple binding, nested var, destructured catch, lexical collision and
strict simple catch), or eight dynamic-function import.meta/new.target/super
contexts. These are negative findings, not fixes. The first catch runtime
probe stopped at an expected rejected program; a parser comparison with both
native and guest exceptions handled then checked all six cases explicitly.

The refreshed candidate's 23-build closure and four import checks passed.
Its full SafeJS unit suite finished with 22,129 passed, 10 failed and 37 skipped
tests across 768 files (7 failed, 760 passed, one skipped), taking 1724.64 seconds.
Historical Promise compatibility/history replay no longer failed.

Remaining failures: ordered PPR2 fresh-writer co case; failed-run deadline
recovery; run.snapshot's mid-run dump timing assertion; fast adversarial corpus
979.7ms versus its unchanged 750ms limit; four camera cases; mutable-closure
stress width 24; object-alias pick-transform deadline. Most are timeouts, but
the dump assertion requires its own reproduction and diagnosis. No limits or
assertions have been weakened. The candidate is not green.

Post-run checkpoint diagnosis: synchronous lexical identifier reads had gained
two unnecessary await boundaries in the binding-reference implementation.
Removing those boundaries repairs the unchanged isolated mid-run dump test in
the candidate. Main-tree full snapshot and failure-replay suites now pass;
the three-file selection still times out in the PPR2 co case (66 passed, one
failed). Historical/trusted/pending Promise replay checks pass 61 cases and
Promise/with checks pass another 82. TypeScript passes. These are focused
results, not a replacement for a complete refreshed workspace run.

This run excludes the later loop-var/comma/let changes, named-function
self-binding work, repeated block functions, array call-context experiment
and all experimental weak collections, as detailed below.

The maintained build and complete lint route passed in the isolated checkout
at `/Users/kjopek/Workspace/safejs-dynamic-validation.ZQOhwV/checkout`.
The checkout excludes later local grammar and snapshot followups and retains
an older SafeBash base than the currently fetched remote main.

Root `npm test` completed unsuccessfully on September 8. Shared workspace unit
tests passed 20,241 cases (two skipped); Python passed 29 cases; the SafeBash
runner passed 284 cases. SafeBash's main suite passed 22,308 cases, failed three,
and skipped 86. Its terminal failure prevented this run from proving the
remaining workspace tasks, including the SafeJS unit suite.

Observed failures, not dismissed as environmental:

- Archive B05 blocked compressed extraction: acceptance deadline exceeded,
  3,125 ms.
- Plain archive record boundary 65,537 with one-byte fragments:
  `ShellLimitError` for `maxWallClockMs`, 30,069 ms.
- Hazardous structured expansion child: `spawnSync` ETIMEDOUT against its
  one-second deadline, 1,057 ms.

Before implementing any repair, reproduce against current code and account
for the intervening upstream SafeBash changes. Do not relax the deadlines or
alter protected staged SafeBash edits. This result is not a passing full gate.
Pushes and releases remain paused.

After the root run terminated, 18 SafeJS implementation/test files were
synchronized into the isolated checkout and verified byte-for-byte against
the working tree. This includes the subsequent grammar, arguments, strict
destructuring and dynamic-source validation fixes, plus the upstream shallow
snapshot-fixture copy. The maintained SafeJS build closure passed (23 builds
derived from declarations), including all four fresh-process import checks.
The full SafeJS unit run subsequently ended with 21,953 passed, 65 failed and
37 skipped tests across 758 files (11 failed, 746 passed, one skipped), taking
2,228.91 seconds. Earlier whole-checkout build/lint results do not
automatically validate this refreshed candidate.

A focused attempt to reproduce the three SafeBash failures in the primary
working tree could not load the SafeJS built safe-fs exports. Those three
module-loading failures are not reproductions of the deadline failures.
The archive compression implementation also differs from fetched remote main;
no speculative timeout repair has been made.

## Pending followup synchronization

A read-only comparison confirmed these eleven later SafeJS files are outside
the currently running candidate. Keep the candidate frozen until its unit
handle terminates; then transfer current full blobs/normal contextual patches
and verify byte equality again, rather than staging stale insertion patches.

Modified candidate files:

- `src/parse/parser.ts`
- `src/parse/tokenizer.ts`
- `src/parse/contextual-arrow-parameters.test.ts`

New candidate files:

- `src/parse/contextual-labels.test.ts`
- `src/parse/reserved-identifier-positions.test.ts`
- `src/parse/strict-reserved-references.test.ts`
- `src/parse/strict-restricted-targets.test.ts`
- `src/parse/labeled-functions.test.ts`
- `src/parse/statement-body-declarations.test.ts`
- `src/parse/for-of-async-lookahead.test.ts`
- `src/snapshot/labeled-functions.test.ts`

All paths are relative to `packages/safe-js`. This list does not include or
authorize bringing in the excluded weak-collection or host-Promise work.

Subsequent synchronization: all thirteen paths listed here (including the
legacy for-in additions below), plus the replay interpreter repair and its
with-call regression file, were byte-verified against the primary tree.
A new maintained SafeJS build/unit run is active. Its 23-build workspace
closure and all four fresh-process import checks passed. The later loop-var
conflict repair, for-in comma-expression repair and ignored-initializer lint
rename are outside this frozen run, along with these new tests:

- src/parse/loop-var-conflicts.test.ts
- src/parse/for-in-sequence.test.ts
- src/snapshot/for-in-sequence.test.ts

The subsequent for-of let-lookahead repair adds
src/parse/for-of-let-lookahead.test.ts and further parser changes outside the
same frozen run. Its three native mismatches were reproduced before editing.

Named-function self-binding followup (also outside the frozen candidate):
scope cells preserve non-strict immutable-write semantics, with caller strictness
passed through assignments, updates and patterns. This changes interp/scope.ts,
interp/async.ts, interp/interpreter.ts, interp/patterns.ts,
snapshot/guest-heap.ts and snapshot/guest-heap-validation.ts, and adds
interp/globals/dynamic-function-self-binding.test.ts and
snapshot/dynamic-function-self-binding.test.ts. Seven native mismatches were
reproduced before repair; focused runtime and recovery checks are underway.

Experimental weak-collection index cleanup now changes interp/weak-collection.ts
and interp/globals/weak-collections.ts and adds
interp/weak-collection-cleanup.test.ts. These remain excluded with the rest of
the weak-collection work. Fifty-one focused tests and native object-key lifetime
probes passed; Node 18 weak symbols remain unresolved.

Repeated non-strict block-function declarations are another local followup
outside this candidate. Eight native execution cases failed before changes to
parse/parser.ts and interp/interpreter.ts; the initial 42-test selection passes.
New files are interp/globals/dynamic-duplicate-block-functions.test.ts and
snapshot/duplicate-block-functions.test.ts. Broader checks remain active.

The later legacy for-in initializer work adds two more pending test files:
`src/parse/legacy-for-in-initializers.test.ts` and
`src/snapshot/legacy-for-in-initializers.test.ts`, plus further parser changes.

## Full SafeJS failure triage

Most failures reported five-second timeouts: CLI source startup; genuine v6/v7
Promise-history replay; preserved ppr2 history; function syntax stress; Float32
iterator resize restore; shadowed-array snapshots; regex checkpoint replay;
and Math.f16round checkpoint replay. Object-alias validation reported a sandbox
deadline budget error. Two Promise compatibility cases reported an already-
running sandbox (one displaced the expected source-mismatch error), requiring
investigation of unfinished prior replay versus an independent lifecycle bug.
Do not dismiss these as environmental, relax deadlines, or rewrite immutable
history fixtures. Reproduce focused failures and measure before changing code.

Focused triage reproduced 15 failures in the genuine v6 compatibility file.
Identifier-call evaluation skipped the normal replay node boundary. Restoring
normal node evaluation made the initial 74-test history/with selection and all
nine remaining failed suites (170 passed, one skipped) pass. The final repair
uses a reference observer rather than serialized completion metadata; its
checks are in progress. See safejs-identifier-call-replay.md. No full-suite
green result or local commit is claimed yet, and publication remains held.
