---
title: Thenable continuation validation
---

# Completed thenable invocation continuations

Next atomic compatibility improvement after typed-array accounting delivery
38adc5d6a. A read-only adoption-resolver review did not establish guest access to
the internal adoption callback; do not add it to callable validation merely
because its heap kind exists.

Concrete different gap: Promise.resolve({then(resolve,reject){finish=resolve}})
can finish invoking then while remaining pending until an escaped resolver is
called. Two tests in snapshot/thenable-continuations.test.ts compare native JS
and ordinary SafeJS execution for fulfillment and rejection. Both controls return
[7,1,status]; fresh snapshots fail with Cannot serialize host reference at the
captured resolver's .call. These are active red regressions, not exclusions or
passes. Runtime code is unchanged so far.

Current resolveThenable in interp/promise.ts stores settlement, completed and
invocationPending in native locals. It creates two native closures, schedules
completion in a promise job, and resolves a native Promise. Its completion gate
waits until invocation has returned; first settlement wins, including resolving
with another thenable. Budget/reentry errors bypass ordinary rejection recovery.

Represent this state explicitly. Preserve source thenable and owning promise,
first-settlement lock, completion phase, resolver identity, and recursive adoption.
Rebuild a completed invocation's pending bridge without rerunning the then getter
or then method. Keep active invocations unsupported unless their actual frames
can be restored; do not drop the guard to make serialization appear successful.
Link the represented native promise to the owning pending capability so restored
resolvers settle the restored owner, with cycles allocated before decoding.

Required regression scope: both outcomes; first call wins; resolve-then-throw;
delayed settlement followed by another thenable; getter and invocation counts;
accessor/bind use for guest-visible resolvers; own-property retention; shared
resolver identity; retained-data accounting; malformed references/phase/ownership;
public checkpoint save/resume. Do not increase timeouts or resource limits.
Use one commit/main push after verification and monitor releases independently.

Implementation in progress: extracted settlement/completed/invocationPending into
ThenableContinuation and indexed the escaped resolvers by shared state. A new
runtime ownership test failed because intrinsic Promise.resolve wrapped a native
resolution promise without an owning pending capability. Its fast path now uses
the existing createPendingPromiseCapability and resolver, preserving same-promise
identity checks and generic constructor handling. The ownership test and six
related Promise/constructor/replay files now pass 129 tests.

This is not finished snapshot support. Encoding/restoration, callable resolver
metadata, retained-data accounting, owner-map cleanup on settlement, recursive
thenable replacement and adversarial validation remain. In particular, nested
thenables can replace the owner's current continuation while older escaped
resolvers must remain locked; do not confuse owner-map cleanup with forgetting
an escaped resolver's first-settlement state. No commit or push yet.

Extracted createThenableBridge(state, options), returning native completion
promise, resolver pair, invocation completion callbacks and fatal reject hook.
resolveThenable now creates state, invokes the guest then once, and uses this
factory; restore can build a completed invocation without invoking then. Native
promise completion removes the owner's map entry only when it still identifies
that same state, preserving nested replacement. Runtime tests cover cleanup and
independent reconstruction without settling the original bridge.

A further regression confirmed missing source retention: an enumerable
400-character payload on a source reachable only from its escaped resolver
contributed zero bytes. Resolver retainedValues now exposes source, owner and
settlement value; the regression passes. The latest four-file runtime selection
passes 101 tests. The two end-to-end snapshot regressions remain unimplemented;
heap encoding/restoration and adversarial checks are still next. Do not commit
this partial implementation or add new test exclusions.

The first snapshot implementation now passes both original delayed resolve/reject
regressions. Added thenable-state and thenable-resolver heap records, pending
capability linkage, first-phase validation and a separate restoration bridge map.
Bridge placeholders are allocated before deferred reference decoding, preserving
cycles. Internal thenable state is rejected by ordinary heap-value restoration.
Runtime resolver metadata was also concretely wrong (undefined name/length versus
native empty name and length 1); guest-function metadata now matches native.
The current two-file selection passes six tests and all seven changed TypeScript
files have zero diagnostics.

Still required before delivery: reciprocal owner validation when a malicious
record removes the owner's thenable link; public-dump internal-reference checks;
getter/call counts, bound/accessor resolvers, nested and completed settlement
snapshots; active phase rejection; broader Promise/snapshot tests; lint/build and
real CLI checkpoint validation. This is still uncommitted implementation work,
not a delivered feature or complete thenable support.

Three adversarial regressions confirmed accepted missing owner back-links and
direct/nested internal-state references in public dumps. Reciprocal ownership
and position-scoped internal-reference validation now reject all three; the
three-file selection passed 20 tests. Public malformed-data tests wait for the
run to finish before dumping: dumping at the first await initially hit the active
invocation guard, which remains intact and still needs checkpoint integration
investigation (not removal).

Added native/control/restored cases for setter resolvers, nested thenable
replacement and resolve-then-throw; those pass. A getter-plus-bound-resolver case
fails earlier, in ordinary SafeJS execution: after Promise.resolve of a then
getter and one await, native has assigned finish, but SafeJS reaches finish.bind
while finish is undefined. This is a validated runtime microtask-ordering gap,
not a snapshot decoding error. The test remains red in
snapshot/thenable-continuations.test.ts; do not exclude or weaken it. Investigate
getThenable's async getter handling and promise-job ordering next. Latest test
file result: eight passed, one failed. No new delivery claim or commit.

The getter-ordering regression is now fixed without extra awaits in its source.
Promise resolution reports only the synchronous getter prefix to the capability
resolver; intrinsic Promise.resolve waits for that prefix before returning its
capability, not for eventual thenable settlement. Getter errors still reject the
promise instead of escaping the caller. The formerly failing snapshot case and
related six-file selection pass 119 tests. Four additional native ordering traces
cover intrinsic resolve, withResolvers, constructor executor and throwing getter;
the two focused thenable files now pass all 17 tests. The full snapshot suite is
running. Active invocation checkpoint behavior and full delivery gates remain.

The full snapshot suite passed 1,336 tests across 76 files. A subsequently added
live-run checkpoint regression then confirmed the anticipated integration gap:
dump(run(source)) at the first await rejects active thenable state even though
ordinary execution returns [7,1]. This new test is red; nine other thenable
snapshot tests pass. Do not remove the active-state guard or move the checkpoint
after completion to hide this failure. Investigate safe yield selection or the
existing trusted-run replay metadata path (dump-format.ts collectContainerStats),
while retaining low-level rejection of genuinely active native continuations.
The change is still local and must not be delivered before this gate is handled.

Live checkpoint now passes without weakening active-state admission. Active
thenable capture throws SnapshotNotReadyError (a TypeError); a pending live dump
request stays queued for a later serializable yield. Finalization still rejects
if state remains unserializable. Direct serialization retains its rejection.
New controller tests check both deferred success and terminal failure; live
thenable save/resume and existing dump/external/signal checks pass 42 tests across
five files. No native continuation is restored and then is not rerun by heap
restoration. Broader package, lint/type, build and actual CLI gates remain.

Scoped ESLint passed for all 11 changed TypeScript files. The first type check
found Promise<void> incompatible with the closure's Promise<SandboxValue> return;
the synchronous prefix now explicitly resolves undefined. The refreshed check
passes with zero diagnostics across all 11 files. The package unit run is active
with only the two documented pre-existing unresolved-gap files excluded; no new
exclusions. Runtime files must remain stable during that run.

Prepared the real CLI pair using the SafeJS skill. Its native Node control passes:
result=7, nestedValue=9, order=[getter,caller,then], calls=1, zero agent spawns.
This checks its expectations, not SafeJS CLI execution. The built CLI and
checkpoint save/resume screenshots still need validation after the package run.

Package unit verification completed successfully: 19,654 passed and 41 skipped;
635 files passed and one skipped, 424.12 seconds. Only the two previously
documented unresolved-gap files were excluded. Runtime files remained unchanged
during the run. Protected staged safe-bash patch is still
d770ec782b2a4ae7e2580e63ded765933890a1c5. The maintained build is starting next.

Delivery gates passed: maintained build completed 70 declared workspace builds,
root suffix stages and all four SafeJS built-import checks. The real CLI pair
passed checkpoint save and resume at
/tmp/safejs-thenable-replay.rIx6WM/checkpoint.json; both screenshots were visually
inspected. It used zero spawns, so this is runtime/CLI rather than model evidence.
A native Node 18 built-module JSON snapshot/restore probe also returned [7,1] for
a delayed resolver supplied by a then getter. The atomic change is ready for
commit and remote-main verification; release publication is a separate gate.
