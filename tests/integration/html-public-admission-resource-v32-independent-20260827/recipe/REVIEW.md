# Independent HTML admission v3.2 resource recipe, version 1

Authority: independent reviewer leaf, August 27, 2026 America/Chicago.
Only this new directory is owned. No delegation, product, root configuration,
private code, author evidence, original evidence or other leaf writes.

## Authentication and static review

PREFLIGHT.json authenticates the exact root-provided recipe/evidence commits and
manifest digests, all 176 v3.2 files including the manifest, all 78 v3.1 files,
their committed blobs, and the exact narrow live inventories. It also verifies
every AMENDMENT base/patched/new-runtime hash, all 103 original PIN source
bindings, original tool identities and actual original import paths. No global
live-tree inventory is used. v3.1/v3.2 policy and tool objects are deeply equal.
The complete core SHA256 remains
446c14f2e12753b8933aa307f7ce8b0dec90dd251bbd613e64a484c26397340d.
The candidate aff899aa94ed0c57a936b08fd36d185688f5c0bb is provenance, not executed.

Direct review covered coordinator.mjs, worker.mjs, ordered-stop.mjs,
aggregation.mjs, hashStream/hashProcess in core.mjs, telemetry.mjs,
producer-observer.mjs, consumer-observation.mjs, terminal-predicate.mjs,
stream-fixture.mjs, authenticate.mjs, bindings.mjs, and the v3.1-to-v3.2 worker
and coordinator changes. Forwarding controls were inspected as static inputs;
their actual children and the original synthetic controls are not rerun.

The author records 28 unchanged synthetic predicates, six forwarding cohorts,
eight ordered predicates and 33 read-only checks. Inventory/count and source
identity authentication are independent STATIC checks, not independent passes
of those cases. The producer fixture, core, terminal predicate, consumer observer,
producer observer, telemetry, synthetic declaration and synthetic implementation
are byte-identical to their stated bases. PIN, worker and coordinator are declared
changes, not falsely called unchanged. Source semantics of every synthetic
mutation are not independently re-executed or exhaustively re-proven.

The controlled timeout/allocation stop keeps the real producer ChildProcess,
checks ownership/open stdout, sends SIGTERM, awaits exit while stdout is still
open, then destroys stdout and awaits close before returning the original Error.
Waiting for close before destroying the unread pipe would risk deadlock. Both
bounded waits share one 3000ms grace; each timer is cleared in finally. Core
preserves the original error and attaches the actual process close record.
The normal core timer clears only after close; this is not a universal repair
for arbitrary consumer/host failures. Worker settlement persists numeric receipt
with fsync before IPC forwarding; allocation intentionally waits for a real kill.

Consumer-failure acceptance remains the original strict SIGTERM alternative OR
identity-bound structured EPIPE/write/-32 exception. The author's observed EPIPE
is not a promise that all repetitions must choose EPIPE; no other exception is
added. Exit7 must remain failure code STREAM_PROCESS and consumer exit17.
Timeout must remain exact V3_TIMEOUT, not an EPIPE substitute. Allocation must
cross the original absolute RSS threshold with retained touched Buffers, then
close the producer and durably write BEFORE-KILL before signaling the live worker.

The supervisor clears deadline, hard deadline, escalation, abort grace and
control-timeout timers after awaited close. Its bounded hard-deadline fallback
signals, destroys pipes and unrefs without an awaited successful close. It marks
this unsafe and stops: this is fail-closed classification, NOT a universal reap
guarantee. Lost group ownership refuses stale leader signaling. The independent
outer observer requires actual exit/close and a fresh empty-group/PID-absence
probe before recording successful settlement. Those observations are not PID
leases, and synchronous ps/git plus fsync can delay timers. No hard real-time
claim, universal cleanup guarantee, or whole-verifier RSS bound is made.

## Exact adaptation and execution

ADAPTATION.json contains each exact replacement and original/adapted hashes.
adapt.mjs verifies that groupMembers, pidState, optionalJson and the complete
controlRun body remain byte-identical. Original author files never change.
Only imports point back to authenticated originals, output authority relocates,
and unrelated synthetic/forwarding precontrol dispatch/results are excluded.
The actual worker, core, producer and predicates remain original imported bytes.
The unchanged runIndependent aggregator preserves its safe-independent-cohort
semantics: unsafe stops; ordinary semantic failure cannot become an aggregate pass.

Exactly one launch, five cases in order: positive, producer-exit7,
consumer-failure, timeout, allocation-mutant. No retries or new generation.
Positive/exit7 input 1073872896 bytes, 16386 producer writes, SHA256
f5b4c8bf0f2f882ef51effdb305a5edf1c8c657d05ba2fd7594c679478fe668f.
Absolute consumer RSS strictly below 268435456 for positive; no baseline
subtraction. --max-old-space-size=96, control deadline45000ms, cleanup grace3000ms,
timeout250ms after ready; allocation8388608 bytes/step, max40 steps,
overshoot strictly below67108864 bytes. All original predicates/status categories,
budgets, ordering, stream chunks and negative-control semantics remain unchanged.

observe.mjs is a disclosed transparent preload in coordinator/worker/producer.
spawn arguments gain only --import with this sealed module; no heap/input/policy
argument is replaced. It forwards exact results/exceptions, observes completed
file fsync, first postraw assertion, actual child kill calls, process self-signals,
and child exit/close. The observer adds synchronous fsync I/O and some memory/time;
this overhead is included in component samples, not subtracted. Its logs use
captured native functions to avoid recursion. It installs no SIGTERM or ordinary
uncaught-error handler. Instrumentation runs before original error/ordering hooks.
No speculative historical cause is inferred from the resulting measurements.

Durability means fsync returned for the numeric files/journals before the observed
assertion or relevant kill. It does not claim parent-directory fsync, transaction,
crash/power-loss durability, or that a producer's final receipt predates the FIRST
SIGTERM: producer baseline/sample journals predate it; its final receipt is fsynced
in its existing handler before its self-SIGTERM. The allocation worker's kill must
follow BOTH final receipts and actual producer close.

launch.mjs authenticates the committed independent recipe and original bindings
before the sole exclusive INVOCATION-LOCK and actual spawn. Its output captures
stdout/stderr directly to owned files and awaits coordinator exit/close. The
coordinator owns five detached worker groups; each worker owns one producer.
All async subject children must have observed exit/close, and all eleven process
PIDs plus all six groups must be absent/empty at final settlement. Synchronous
git/ps helpers are bounded and return after wait; no helper result is used before
return. No extra resource case, forwarding child or build is launched.

Node/git/ps and native tar identities/realpaths are frozen in PREFLIGHT.json;
tar is used only for later raw compaction. /usr/bin/tar's resolved bsdtar alias is
an explicitly authenticated TOOL alias, not an allowed product/build-input
symlink. Auth uses Node22.22.2 and its authenticated bundled builtin modules.
The author's own path resolution, core imports and injected observation preload
are static-inspected and pre/post hash-bound, not merely proposed API names.

Pre-freeze own-observer static correction: its exit listener must not close the
observation descriptor before later original producer exit listeners persist
their receipts. It now leaves final descriptor closure to process teardown.
No case ran with the earlier draft. The process-exit-event record is event entry,
not proof that all later exit listeners finished; awaited parent close is proof.
Syntax checks and preflight authentication are not actual resource-case runs.
No resource case is executed before a separate atomic recipe commit.
Run the frozen launch once using its recipe commit, then read-only postcheck once.
Any real failure is preserved and reported; no control rerun or automatic repair.
Verifier-only postcheck failures remain raw and separately labeled if a later
documentation/formatting correction is necessary. Final evidence is committed
separately after raw compaction/exact hash verification and scratch cleanup.

## Unchanged history and holds

Original independent d28083dd admission-v2 remains34/35 RSS HOLD, numeric RSS
lost/unrecoverable. e579a96c diagnosis proves neither its cause nor a rescore.
All v2/v3/v3.1 failures remain unchanged; no composite old gate passes. The
original raw first rejection is missing, its separate synthetic capture stays
synthetic, and all three author development failures remain retained.

The separate partial independent leaf recipe
bf72a1f9d0eaa843e1e3a33949993a7d4a338d96 has its own one4-controls plus410build/
830pack/two-path scoped reconstruction evidence. This leaf neither changes nor
reruns it; root alone combines results. HTML actual34 remains0/unexecuted until
root release; no product/public/HTML74 acceptance. DU29 and A06/P03 remain held;
no DU run. No universal parity, superiority, completion or72-hour work claim.
