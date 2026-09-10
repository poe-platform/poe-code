# Host reconciliation disposal

Status: isolated fix under qualification. Main package gate 64545 is live and
main runtime/tests remain fixed. This change belongs in its own atomic commit,
separate from imported-Promise scheduling and pending-Promise checkpoint support.

## Validated failures

The pending-Promise prototype uses the same existing HostCallJournal.reconcile
and disposal behavior as main. Tests in
`/tmp/safejs-promise-depth.bKyGJi/packages/safe-js/src/interp/host-reconciliation-disposal.test.ts`
reproduced two failures (e00f6c): reconciliation invokes a provider after journal
disposal, and a late fulfilled proof is accepted after disposal. A third test
then proved a never-responding provider leaves the reconciliation waiter pending
after disposal (de5b5b). The test uses a next-event-loop sentinel, not a relaxed
timeout or a five-second wait. Production run cleanup binds hostCalls.dispose
as leaveHostReplay, so this is an actual lifecycle boundary, not a fabricated API.

## Isolated repair

The journal records terminal disposal state, rejects new reconciliation before
invoking providers, and tracks cancellation of awaited provider proofs and joined
callbacks. Disposal rejects outstanding waits. Incoming native Promise outcomes
remain observed, including late rejection, but cannot settle the disposed journal.
State is checked after asynchronous boundaries and before recording a result.
This cannot cancel arbitrary external provider work; it terminates the journal's
wait and prevents late journal mutation.

The first selection passed all 23 tests across disposal, existing journal and
pending-Promise public cases (9cc93c). Additional joined-callback and late-rejection
controls are running as 37793; prototype TypeScript is 40371. Do not claim these
passed until their terminal results are collected. No main integration yet.

Before integration, reproduce the disposal tests against the isolated scheduling
candidate, port only this independent lifecycle diff, and run callback/capability
regressions. Do not copy the pending-Promise prototype's unrelated snapshot format
and reconciliation-node edits wholesale. Preserve the main gate's frozen source
until it terminates, then perform maintained build and appropriate main checks.

The expanded isolated run passed all 25 tests across three files (92c8ae),
including disposal while joined callbacks remain pending and a late provider
rejection without an unhandled rejection. TypeScript passed (963c77).
These qualify the isolated behavior only; the scheduling-candidate port,
broader callback checks, scoped lint and main integration are still required.

## Scheduling-candidate compatibility check

Ported the five disposal regressions to the newer isolated scheduling candidate
at `/tmp/safejs-new-promise-capability.KGfWqD`. All five failed before the lifecycle
repair (fc65af), confirming the issue is not introduced by the pending-node
prototype. Ported only the disposal flag, cancellation-aware waits and boundary
guards into that candidate's host-call.ts; no pending-node codec changes were
included. Main runtime/tests remain frozen for package gate 64545.

Broader callback/capability/replay testing is running as 96590 and has emitted
failure indicators; collect its terminal details rather than assuming timing or
semantic causes. Scoped ESLint completed successfully (911cbb). No main port or
atomic commit is qualified by the earlier smaller checks alone.

The broader scheduling/disposal run ended with 519 passes and seven failures
across 25 files (23bfdd, 189.01 seconds). All seven failures are 5000ms timeouts
in run.retained-callback.test.ts: four first/second checkpoint restorations and
three successive/completed histories. All other selected files, including the
new disposal controls and imported-Promise checks, passed. This is not a green
qualification; determine whether retained-callback semantics changed or timing
headroom is inadequate. Do not infer either cause from the timeout alone.

The retained-callback workflow names are also truncated by object-placeholder
formatting, obscuring which second-amount variant failed. Validate and repair
that independent diagnostic problem before relying on precise case selection.

## Pending-provider retention follow-up

A native `--expose-gc` diagnostic holds the external provider Promise alive,
disposes ten journals with outstanding reconciliations, awaits their disposal
errors, drops strong journal references and collects across twelve event-loop
turns. The first control accidentally kept its last loop-local journal live;
moving control construction into a separate function corrected that probe.
The corrected red run retained all ten pending-provider journals and zero of
ten controls (2002e9). Diagnostic:
`/tmp/safejs-journal-disposal-retention.mts`.

Capturing only pendingReconciliations instead of this was insufficient: all ten
journals remained retained (d81756), although the 36 functional controls passed
(cc0b01). Do not report that first attempt as a memory fix.

The newer isolated scheduling candidate now attaches provider reactions in a
separate observer function to a clearable waiter-state cell. Disposal clears
the cell before rejecting the waiter, and late reactions see an empty cell.
The external Promise no longer holds the settled waiter and journal through
its reaction closures. The corrected probe collected all ten journals and
all controls (c8a415). A fresh expanded run also collected ten journals disposed
while waiting for joined callbacks: retained provider/callback/control counts
were all zero (5c6cd2). Prototype TypeScript passed (0654f2).

This is controlled native-GC evidence, not a deterministic unit assertion or a
complete public-run resource audit. Audit real run cancellation with active
async-local contexts before claiming all lifetime paths covered. The change is
only in the newer scheduling candidate; the older pending-node prototype still
has the initial disposal implementation and must not overwrite this refinement.
Functional requalification is session 14943; collect its terminal result.
Main remains fixed and unmodified for live package gate 64545.

Functional requalification completed successfully: 36 tests across four files
passed (12f29a), covering disposal, existing journal behavior and imported host
and input Promise replay. No public cancellation/async-local lifetime claim
follows from this narrower selection.

## Public cancellation and async-local retention

Two public run/checkpoint controls now pass with the five disposal controls
(3aea13): aborting replay before a provider response rejects with the abort
message, does not re-invoke the original host operation, and prevents subsequent
guest effects after either a late fulfillment or rejection. They live only in
the isolated scheduling candidate as run.reconciliation-cancellation.test.ts.

The public native-GC diagnostic `/tmp/safejs-public-reconciliation-retention.mts`
then exposed another retention path: after original completion and replay abort,
one of two disposed journals remained alive while the external provider Promise
remained pending (22558c). Settling that provider collected both (e5c602).
Clearing rejection-tracker records alone did not release the replay journal
(496978); this was a diagnostic-only intervention, not a runtime patch.

Heap snapshots and path reader are in `/tmp/safejs-public-journal-heap.kV0lQP`
and `/tmp/safejs-heap-retaining-path.mjs`. The first snapshot included the probe's
WeakRef keep-during-job root. The corrected capture yields a job and collects
before snapshotting. The path reader excludes weak edges and WeakMap-table
ephemeron shortcuts, while retaining conditional edges from live keys.

The corrected heap shows the provider's pending reaction Promise holding native
async-local kResourceStore references: rejection-tracker records lead to the
sandbox Promise and journal (7fd3b1); replay failure state supplies a second path
(7584d4). Detaching only those two stores was insufficient. Further heap paths
identify the cancellation store's signal (c2292b/1be832) and run-resource methods
capturing that signal (7af141). These are observed paths, not assumptions based
solely on field names.

The isolated observer now attaches Promise assimilation/settlement reactions
outside these four SafeJS stores, while provider invocation and awaiting guest
continuations retain their original context. It does not disable shared stores
or discard arbitrary caller async-local state. activePromiseTracker and
activeCancellation are newly exported only from their internal source modules;
the package SDK exports have not changed. The public GC probe now collects both
journals while the provider is still pending (2367b5).

A deterministic host-reconciliation-context.test.ts checks provider invocation,
the inert observer, preservation of caller context, and restoration of guest
context after awaiting. It and existing functional cases are running as 39989;
TypeScript is 30697. These changes remain isolated and unqualified pending those
checks, scoped lint, broader callbacks and maintained build/native-import checks.
The main package gate 64545 has now terminated; its 21 failures are recorded in
safejs-completed-promise-expectation-refresh.md and are not a green gate.

The focused context/public-cancellation/disposal/journal/imported-Promise run
passed all 39 tests across six files (b5488c). TypeScript passed (4695f3).
The new observer test subsequently received an explicit this type annotation
only; runtime and test behavior are unchanged. Scoped lint has started on the
refined runtime and affected tests. Do not conflate these focused results with
the still-required broader callback and native-import qualification.

Current live check: scoped lint session 86134 (started after all earlier sessions
with that numeric identifier had terminated). Main full gate 64545 is terminal;
do not poll/restart it as if it were still running.

## Recovered terminal refinement results

Scoped lint completed successfully (034051). The subsequent callback/context/
disposal/public-cancellation run is also terminal: its JSON report at
`/tmp/safejs-disposal-callback-refinement.json` reports 29 passed, zero failed,
zero skipped and success=true. Process inspection confirms no matching test
process remains. This includes all 21 retained-callback tests; the seven earlier
timeouts did not recur in this run. It does not prove their underlying timing
cause or establish full-package reliability. Maintained build/native-import
qualification and main integration remain outstanding.

## Main red/green integration

Ported the five disposal regressions and two public cancellation controls before
changing main runtime. All five disposal regressions failed (ae1b89); both public
cancellation controls already passed. Thus public abort completion alone does
not prove journal cleanup. Main exhibited pending waits after disposal, accepted
late fulfillment, propagated the late provider rejection instead of disposal,
and invoked the provider after disposal.

Ported only the reviewed disposal/observer diff in host-call.ts and the two
internal AsyncLocalStorage exports in cancel.ts and promise-tracker.ts. No
pending-imported-Promise snapshot format was included. Main integration is
running as session 25056 across disposal, context, public cancellation, all
retained callbacks and nested imported-Promise replay. Keep runtime fixed until
terminal; maintained build/native-import checks remain required.

The unrelated CLI filesystem recheck passed all 28 unchanged tests (0f51d4).
The first legacy invocation took 2926ms and later invocations roughly 28–44ms.
This is not a reproduction of either full-gate failure or proof of their cause;
no filesystem implementation was changed.

Main integration completed with all 34 tests across five files passing (7fb8e8),
including all five previously failing disposal cases and all 21 retained-callback
cases. Scoped ESLint passed (10baf8). The maintained SafeJS workspace closure
passed all 23 builds and all five fresh native ESM import checks (5078c7).
The lifecycle diff remains uncommitted and must be separated from the earlier
uncommitted imported-Promise scheduling diff in host-call.ts. No full-package
green claim follows: the last full gate had 21 failures, and the most recent
unchanged focused camera run still had one 5000ms timeout among 11 tests
(a86dca). No push, release, or issue closure occurred.

Atomic commit preparation uses a separate Git index based on HEAD, selecting
only the disposal hunks from host-call.ts plus the two context exports, three
test files and this plan. The working file is not reverted or replaced, and the
user's staged Safe-Bash files remain in the original index. The shared
promiseReplayContext import is needed by this repair's observer; the scheduling
field, graph restoration and serialized IDs are excluded from this commit.
