---
title: Promise aggregate continuation validation
---

# Pending aggregate promise continuations

Baseline e5d83e664 and its maintained pending-promise-species tests established that
pending Promise.all, subclass all and Promise.race results cannot be captured as
complete low-level continuations. Their controls settle correctly; snapshot
admission rejects them rather than silently dropping their callbacks. The trusted
public replay path is separate and must remain intact.

In settleIterable, inspect and preserve the shared method, result capability,
indexed values and remaining count. Per-entry callback pairs share a called flag;
that identity prevents duplicate settlements from decrementing twice. Capturing
only the result promise or rebuilding by calling Promise.all again loses state
and can repeat iterator, constructor.resolve and thenable effects.

Next tests must first run unsnapshotted controls, then restore a fresh snapshot:

- all with one settled input and one pending input, preserving input order;
- allSettled with mixed fulfillment and rejection;
- any preserving rejection order and AggregateError.errors;
- race preserving the first completion and later handler effects;
- subclass results and custom resolving callbacks;
- repeated callback invocation and partial completion;
- constructor, iterator and thenable counters that do not repeat on restore;
- result-only roots retaining every live producer;
- malformed ownership, indices, counters and callback identity;
- retained data accounting and cleanup after completion.

Represent aggregate callbacks explicitly and reconnect their existing reaction
records. Preserve separate producer and result lifetimes, including early result
settlement. Do not replace pending results with inert promises, treat replay as
low-level restoration, or claim arbitrary custom/active iterator continuations
are complete from narrow intrinsic cases. No implementation has been started.

Validated September 7 against e5d83e664: new pending-promise-aggregates.test.ts
has four failing restoration regressions for all, allSettled, any and race.
Every unsnapshotted control passes, including subclass identity and exactly two
constructor.resolve calls. Each fresh snapshot then rejects an unrepresented
promise continuation before restoration. The first three use an already settled
input alongside a pending input; race uses two pending inputs. These are local
TDD work in progress, not published fixes or additional test exclusions.

Inspection of settleIterable confirms its aggregate values, remaining counter
and shared per-entry called flag originally lived only in native closures. The
result is explicitly marked unrepresented. Preserve those states and producer
edges rather than merely removing the admission guard.

Implementation in progress: PromiseAggregateState and PromiseAggregateEntry now
hold the live values/counter and shared called flag. createPromiseAggregateHandler
constructs callbacks from those records and records callback origin in a WeakMap.
A new state regression was red before implementation, then passed: allSettled's
resolve/reject pair shares one entry, distinct entries share one aggregate,
duplicate settlement does not decrement twice, and partial results are retained.
Eight focused Promise/iterable/order/trusted-replay files pass (225 tests).

This is not yet a completed atomic fix: heap node capture, validation, restoration,
result-only producer reachability and accounting regressions remain. The four
end-to-end snapshot tests remain red. Keep the admission guard until actual
restoration is complete; do not publish this as aggregate snapshot support.

Heap implementation now includes aggregate, entry and handler records. A direct
escaped-callback test with module-scoped custom capability resolvers passes a
JSON snapshot round trip, preserving a completed first input and the shared
called flag. Ordinary pending aggregate result ownership is not yet represented.

Additional validated gap: using `function C(executor){executor(value=>{
this.value=value},reason=>{this.reason=reason})}` as the custom constructor makes
its resolver closures retain C's activation/arguments, including the native
createPromiseCapability executor. Snapshot capture then rejects that executor's
`.call` host reference even after aggregate handlers are represented. Preserve
this case as a separate capability-executor origin requirement, not evidence that
custom constructor closure restoration is complete. The isolated callback test
uses module-scoped resolvers so it exercises aggregate state without that gap.

Pending intrinsic aggregate producers are now linked to their actual result and
serialized/restored reciprocally. All four initial aggregate regressions pass,
and 71 neighboring Promise/subclass/iteration/replay tests pass. Former negative
aggregate admission tests now perform real restoration and settlement checks.
The guard is only cleared after a completed iteration whose input then methods
and completion promises are represented; custom then and active iteration remain
guarded. Producer cleanup follows reaction completion, not early result settlement.

Further validation is still required before committing: malformed ownership and
counter/index integrity, retention accounting, early-result and duplicate-input
cases, changed-file types/lint, package regression checks and real CLI validation.

Validation progress: three new malformed-snapshot regressions were confirmed red
before fixes. Entries can no longer name indices beyond the aggregate's recorded
input count; remaining counts are bounded by that count and whether iteration
ended abruptly; producer redirection must agree with known handler result owners.
Active iterator capture is explicitly rejected. Input count is independent of
the mutable values array, which can escape after completion. Seventeen focused
aggregate/subclass/validation tests pass. A separate memory-accounting check
confirms growing a partially settled value by 400 characters adds exactly 400
to data retained through the aggregate result. Scoped lint passed before the
last ownership check; rerun for final delivery.

Full maintained SafeJS unit route started September 7 at 17:01 Central (terminal
14755), with only the two previously documented experimental exclusions. No
aggregate tests are excluded. Do not start concurrent CPU-heavy lint/types/build
work while this run is active. Latest type pass found only assertion narrowing
errors in the new validation test; assertions were strengthened, pending recheck.

First full run finished in 403.94 seconds: 19,574 passed, 41 skipped, two failed
in the two newly added edge cases. Reused species exposed stealing an older
producer from another aggregate; callback property assignment failed even in
the unsnapshotted control. These are confirmed defects, not merely hypotheses.
Producer selection now uses newly registered source reactions rather than every
producer of a possibly reused species result. Aggregate callbacks now use normal
guest-function state, and snapshots capture/restore their properties/prototype.
Rerun full verification after focused checks; the previous full run is not green.

The real CLI validation pair has been authored following the SafeJS skill. It
uses no agent spawns and does not establish model behavior. Build and screenshot
execution remain pending; its source must not be mistaken for execution proof.

Latest validation: the species-getter reentrancy regression first observed two
claimed producers instead of one. Linking now also matches the actual aggregate
callback pair, excluding unrelated reactions created during species lookup.
Nine focused tests then passed; duplicate-input and already-settled-race cases
also pass (seven aggregate snapshot cases total). Changed-file TypeScript checks
and scoped lint passed, followed by the maintained build: 70 declared workspace
builds, root suffix stages and all four SafeJS built-import smoke checks.

The rebuilt CLI harness passed normally, with a checkpoint save, and with resume
from /tmp/safejs-aggregate-replay.lKViLr/checkpoint.json. All three PNG screenshots
were opened and inspected. These are real-runner/replay checks with zero agent
spawns, not model behavior or substitutes for the low-level restoration tests.

Final full SafeJS run is active as terminal 1859, with the same two documented
experimental exclusions and no aggregate exclusions. Runtime edits are frozen
for this verification. Commit and push remain pending its successful result.

## Delivery verification

Final package run completed successfully: 19,579 passed, 41 skipped; 627 files
passed and one file skipped; 378.37 seconds. Only the existing host-Promise import
property and weak-collection experimental files were excluded, not counted as
passes. Native Node 18 restored a pending Promise.all snapshot and settled it to
[3, 7]. The maintained build, scoped lint, normal CLI run and checkpoint save/
resume screenshots passed as recorded above. This supersedes earlier in-progress
status entries; remote delivery and publication are tracked separately.

This improvement represents aggregate callbacks and pending intrinsic input
reactions, including ordinary subclasses and partially settled inputs. It does
not claim active iterator capture, arbitrary host continuations, or the separate
native capability-executor capture gap are complete. Those remain work toward
the broader JavaScript-completeness goal.
