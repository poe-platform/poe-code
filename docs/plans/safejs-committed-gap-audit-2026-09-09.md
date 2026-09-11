# SafeJS committed-runtime gap audit, September 9

This audit covers local commit `cae903ff2`, not remote main or a release. It
supersedes older presence claims only for the bindings checked below. It is not
an exhaustive JavaScript conformance assessment.

## Runtime presence evidence

A source-runtime probe in the isolated committed candidate evaluated `typeof`
for each binding through `run`. It completed successfully (session 58415).

| Binding | Committed runtime result |
| --- | --- |
| eval, Function, Proxy | function |
| Reflect | object |
| SharedArrayBuffer | function |
| Atomics | object |
| WeakMap, WeakSet | undefined |
| WeakRef, FinalizationRegistry | undefined |

The working tree contains experimental weak-collection changes, but they are
not in this commit. Their presence in a working-tree probe must not be reported
as committed support. Existing Proxy and shared-memory bindings likewise do not
establish complete trap, concurrency, recovery, or budget semantics.

## Verification boundary

The previous isolated full SafeJS suite passed at `d9e6c0fe2`: 24,930 passed,
37 skipped. That commit predates run-owned atomic waiter cleanup. The newer
cleanup and guest-error regression selection passes 48 tests; package
TypeScript and scoped lint pass. The selected workspace build passed before
the test-only guest-error follow-up.

A new full SafeJS unit run is live as session 27773 against `cae903ff2` in
`/tmp/safejs-shared-commit.eCW6K7/candidate`. Before launch, all 1,316 tracked
SafeJS source/test files matched their Git object hashes at that commit.
Candidate inputs must remain unchanged until this run terminates. A running
suite is not a passing suite, and a SafeJS package pass is not a repository-wide
pass.

## Remaining investigations

- Complete weak-collection support, including guest lifetime, budget, and
  recovery behavior; do not substitute a binding-presence check.
- Establish live atomic-wait continuation restoration separately from source
  replay. Existing pending-wait coverage explicitly uses replay mode behind a
  re-issued host operation.
- Establish timeout replay behavior and concurrent shared-memory visibility.
  Run-owned worker cleanup and guest error delivery are now covered, but do
  not prove these properties.
- Resolve host-Promise own-property import semantics without copying host
  async-context state into the guest. The separate experimental property tests
  are excluded from this committed candidate, not counted as passing.
- Continue behavioral audits of eval and Proxy; existing implementations and
  focused tests do not prove full JavaScript completeness.

Publication remains held. No push, release, or remote issue closure is claimed.

## Pending atomic continuation reproduction

The new working-tree test `snapshot/atomic-wait-continuation.test.ts` creates a
registered infinite wait, serializes its view and wait result together, and
restores that snapshot. The original buffer has one native waiter; the restored
buffer has zero. Session 91258 first reproduced the restored-count failure;
the follow-up moves the original-registration control before that assertion.
Run-resource cleanup removes remaining registrations even on test failure.

Source inspection explains the missing link: the wait intrinsic creates an
ordinary pending promise capability, and the guest heap encodes it as a generic
`pending-promise`. No atomic view, expected value, timeout, or registration
producer is associated with that promise. Generic restoration can therefore
recreate its promise state but cannot recreate its external producer. The
repair must represent and resume that producer, with registration ordering,
budget, cancellation, and alias tests; source replay alone does not satisfy
direct continuation recovery. This regression remains uncommitted and failing,
outside the unchanged full-suite candidate.

### Restore lifecycle constraint

The regression targets `snapshot/restore.ts`, the synchronous low-level heap
restorer. The public SDK exports a different restore function from `restore.ts`;
`run.ts` uses that public-envelope/source-replay path. Thus the failing heap
test is evidence of missing direct continuation support, not evidence that the
already-tested public source-replay case fails.

Run-owned native wait registration requires an asynchronous worker
acknowledgement. Direct restoration needs an explicit readiness/activation step
before invoking restored guest closures; starting registrations during graph
decoding without awaiting acknowledgement would race immediate notifications.
Activation must follow complete graph validation and budget reconciliation,
preserve queue order, and retain run-owned cancellation cleanup.

Additionally, a registered wait remains queued when the stored value changes.
Reissuing its original expected-value comparison can instead return
`not-equal`. A new control covers this distinction. Direct restoration must
preserve the existing wait state rather than perform a fresh guest invocation;
timeout accounting and restoration ordering need their own controls.

### Working implementation, not yet committed

The working tree now associates pending atomic promises with their view, index,
queue order and timeout state. Pending-promise heap records retain that state;
heap validation checks its shape, and restoration checks managed shared
Int32/BigInt64 storage before any explicit activation. The low-level restored
snapshot exposes idempotent `activateAtomicWaits()`. It registers waits in saved
order and awaits each worker acknowledgement. Callers must await activation
before using restored closures. This does not change the public SDK's distinct
source-replay restore API.

The original failing regression now passes, including changed stored values,
promise settlement, repeated activation and a second checkpoint taken before
activation. The five-file selection passes 37 tests (14899), and package
TypeScript passes (14476). Scoped ESLint also passes (36620). These results
are outside full-suite candidate 27773, whose inputs remain unchanged.

This is not ready for an atomic commit yet: finite timeout accuracy, BigInt
offsets, multi-wait FIFO restoration, malformed-state controls, cancellation
and activation-failure budgeting still need dedicated validation. In particular,
the current timeout start is recorded when registration acknowledgement reaches
the interpreter; it does not yet measure time spent delivering that acknowledgement.
Standalone activation without run resources retains the native lifetime boundary.

### Expanded recovery checks

FIFO restoration now passes with deliberately reversed heap traversal order,
for Int32 and BigInt64 views at byte offset eight. Seven malformed-state cases
are rejected before activation. The tests initially expected raw TypeError for
all failures; six correctly arrived wrapped in the existing
SnapshotValidationError and the assertions were corrected accordingly. Two
cancellation controls prove no restored native waiter remains after cancellation
before or after activation, while the original run's waiter remains intact.

A fake-worker registration-time regression failed first (15463): only the
acknowledgement arrival time was available. The worker now records registration
time and transports it using `performance.timeOrigin + performance.now()`;
the receiving thread translates it to its own performance clock. Both initial
wait creation and restoration retain that origin. Node documents these clocks
in https://nodejs.org/api/perf_hooks.html#performancetimeorigin.

The four-file atomic selection passes 33 tests (24077), and TypeScript passes
(21717). A subsequent controlled-clock snapshot test passes, confirming elapsed
time is deducted and the saved remaining duration stays fixed while a restored
continuation is paused. The recovery file now passes 15 tests (5491). Scoped
ESLint passes (36771). Activation-failure budget coverage and further
snapshot-isolation checks remain before committing this change.

### Activation isolation and budget failure

Mutating the caller-owned snapshot after low-level restoration reproduced two
activation failures (39838): deferred registration read the mutated index from
the original record. Restoration now copies the primitive wait parameters
before retaining the activation closure. Both regression variants pass.

A fault-injection test rejects the second restored wait's metadata reservation
after the first registration succeeded. The activation error is preserved,
run cleanup terminates the worker, and notifying the restored view reports zero
waiters while the original view still reports two. This validates cleanup when
the failed activation is allowed to exit its owning run-resource scope; it is
not a claim of transactional rollback when a caller catches the failure and
keeps that same scope alive.

The worker and recovery selections pass 24 tests (21354); TypeScript (40908),
scoped ESLint (76759), and whitespace checks pass. README now distinguishes the
internal activation API from public source replay. The protected user index
still has patch ID `5aef205cd9aba8165a9884b97907573239bdeb26`.
No commit or push has been made for this recovery implementation yet; the
selected build and committed-only integration checks remain outstanding.

## Terminal full-suite result at cae903ff2

Session 27773 finished with 24,940 passed, two failed and 37 skipped tests
across 983 files (980 passed, two failed, one skipped), in 711.68 seconds.
The camera inverse-coordinate workload exceeded Vitest's unchanged 5000 ms
timeout. The complete original D3 bisector workload in function-arity exceeded
its sandbox deadline. No assertion or timeout has been relaxed. Post-run Git
blob verification confirms all 1,316 tracked SafeJS source/test files still
match cae903ff2. This is not a green full gate and excludes the newer recovery
implementation.

The recovery candidate is exported separately at
`/tmp/safejs-atomic-candidate.VzPvvJ` from private-index tree
`7d5d49d703dfbe9fdd1e98e25cfed97593036bf3`. All 1,318 tracked source/test files
match that tree. Its maintained selected workspace build is running as 73926.
The private index includes only the 11 owned files/hunks and excludes unrelated
weak-collection work and the user's staged SafeBash edits. It has not been
committed. This terminal-result appendix was added after the candidate export.

The selected candidate build subsequently passed all 23 builds and four
fresh-process import checks (73926). Session 96480 now runs the complete snapshot
test directory, atomic wait/shared-buffer tests, and the camera/function-arity
files with one test worker against that candidate. This checks the selected
patch independently of uncommitted weak collections and re-examines both full
gate failures without another full suite or build running alongside it.

The isolated integration run completed successfully (96480): 1,809 tests passed
across 135 files in 204.15 seconds, including both camera and D3 workloads at
their unchanged limits. This supports the recovery patch and demonstrates that
the two workloads can pass in the selected one-worker run. It does not establish
a fix for their full-suite timing failures. Candidate scoped ESLint remains
running as 26957; the same process is still active and is not being restarted.

Candidate scoped ESLint subsequently completed successfully (26957). All 1,318
source/test files still match the selected tree after integration verification.
Only the README punctuation and this audit's terminal results changed after the
tested export. The recovery implementation is ready for its local atomic commit;
no remote delivery or release is authorized while publication is held.
