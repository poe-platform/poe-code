# Private finite fixture-binding protocol

This protocol expands the already committed twelve parameter intentions without
adding records. It is NOT an implemented product adapter. Public API signatures
are absent, so `qualifiedLifetime` deliberately throws UNBOUND. The executable
criteria module contains independent raw-identity assertions, not a fake runtime.
Do not forward this private protocol or questions to the author.

## Common bounded fixture shape

Use the copied Scope/gate/tracked/deadline/owned-child harness. Register invocation
cleanup synchronously before opening operations or admitting work. Start an actual
Shell/registry invocation through public interfaces, not a context.invoke stub.
Every controlled gate is registered for teardown before waiting. Observe promises
with explicit value/error tags so rejected undefined cannot become success.
Retain reason objects and exact thrown values in-process; serialize only after
identity assertions. Reconstructed JSON cannot prove object identity.

The future declared adapter must expose observations already supported by the
public boundary, not add a product API for these tests. Required gates:
commandStarted, localFailureDelivered, localNormallyClosed, cleanupEntered,
releaseCleanup, childAdmitted, childCleanupEntered, releaseChildCleanup and
publicSettled. Only the gates relevant to the parameter are used. Use event
sequence numbers and gated pending-state witnesses, not timing sleeps/race luck.
1200ms bounded waits and 3000ms/1MiB owned child bound; timeout is failure, not a
skipped assertion. No helper may await an uncooperative opaque handler to settle
public invocation. Release/reject task-owned opaque work separately for teardown
and observe late rejection. Teardown rescue is never credited as product behavior.

Registered cooperative cleanup holds public invocation open during exact ordering
tests. The local normal-close path must not itself be blocked by that separate
invocation cleanup gate. The future binding must prove these are distinct lifetimes;
if it cannot, report BLOCKED rather than use an already settled invocation to test
caller priority. No competing finally/close error may replace primary execution.
Register/finally share cleanup completion; execution throws and cleanup rejects are
recorded separately. Caller presence is an explicit boolean, never `reason || ...`.

## S11 ten extra parameters

For error-first parameters, deliver the exact execution rejection, record its
identity, enter and hold cooperative invocation cleanup, abort caller with the
frozen reason, then release cleanup with its frozen error. Assert public caller
identity, local thrown identity, cleanup once and no unhandled rejection.

For caller-first, abort with the unique caller Error, establish signal delivery,
then reject the controlled execution with 0 and cleanup with its own Error.
The late error must be observed without changing public caller identity.

For normal-close parameters, witness local normal completion while the invocation
cleanup gate remains pending, then abort caller. Do not demand retroactive local
abort. The native undefined arm calls abort(undefined) and captures the actual
signal.reason. The separate synthetic literal-undefined arm requires authenticated
public compatibility and reason === undefined; absent compatibility is BLOCKED.
It must never be relabeled as the native-default arm.

With no caller abort, reject execution with literal undefined or unique Error,
and cleanup with its separately frozen Error/0. Public execution rejection wins.
With successful execution and no caller abort, cleanup rejection alone must surface
as literal undefined or 0. The rejected tag and reason-property presence are required.
The ten exact rows/reasons remain those in extra-parameters.json; no permutations
are silently added to the denominator.

## S09 admitted child and S10 independent sibling

S09 registers explicit parent/child ownership before admission, admits one gated
cooperative child, aborts caller with a retained Error, refuses a late acquisition
without starting it, and witnesses public pending while child cleanup is held.
Release child cleanup; public caller rejection may settle only after drainage.
Overlapping registered/finally calls use the same idempotent completion. Opaque
unregistered work, if used as the no-wait control, remains pending until explicit
fixture teardown; its later rejection is observed, not a product drain pass.

S10 closes one child normally, then obtains useful sibling file/stderr effects
while the parent and independently borrowed input owner remain live. Trigger the
unique parent execution Error, then let a different cooperative sibling's cleanup
reject with its unique cleanup Error during parent drain. Parent execution identity
wins. The earlier normally closed child need not retroactively abort. Preserve
operation-originated borrowed-return count zero; permit normal top-level owner
finalization afterward. No sibling-liveness promise after deliberate parent close.

## S08 controls and remaining concrete bindings

The two revised S08 records each contain closed/open/genuine-failure arms under the
bounded record supervisor. Preserve original argv, format bytes and start barrier.
The closed arm is the corrected historical fixture with only the frozen expectation
delta. The open arm must deliver exact writeout; the failure arm makes its sink
reject a retained unique reason without signaling intentional consumer closure.
Required independent effects and established status/stderr/pipefail semantics are
checked on all arms. Exact baseline profiles must be frozen before observations;
native profile is separately observed and authenticated, never chosen to make pass.

`requireWriteoutTriplet` remains UNBOUND: paired-arm wiring, public reachability/
known-close witness, status/stderr/pipefail profiles and independently authenticated
baseline/native replay do not yet exist here. `result.writeoutIntent` is a pending
reviewer observation slot, NOT a declared product hook or invented API. It cannot
be populated by trusting author self-report. If no legitimate public observation
can distinguish a fixture miss, retain BLOCKED.
