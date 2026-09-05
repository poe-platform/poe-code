# Checkpoint replay and host callbacks

Recorded checkpoints contain the initial random state, portable host results,
callback arguments, and an execution-order trace. Restoring a checkpoint rebuilds
script state from the source and replays that history. Completed host-operation
outcomes are reused instead of invoking those operations again. This does not
exclude reconstruction of recorded source callbacks or a configured `onReplay`
hook. A still-pending operation follows its captured recovery policy: re-issue
or external reconciliation.

## Host-operation policy selection

The public Node SDK exports both `declareHostOperation` and
`registerPendingHostCallPolicy`. At host-call issue time the bridge selects:

1. The policy explicitly attached to that function by `declareHostOperation`.
2. Otherwise, the existing named registry's policy for the exact journaled
   `moduleId` and `operation` pair.
3. Otherwise, `"re-issue"`.

Named registration supplies a live default, not just legacy pending-snapshot
reconciliation. It can be installed after a wrapper is created but must precede
the call being issued. The registry is local to the loaded SDK implementation;
there is no per-run registry option. The last registration for a pair replaces
its default. Module normalization also registers explicitly declared exports.
Function declarations still win if the named default later conflicts.

Registration trims required nonblank names and keeps them case-sensitive.
Supply the exact resulting journal names: ordinary caller bindings use
`"<bindings>"`, imported capabilities use their module ID, and nested operations
use their property path. Do not assume lexical aliases are separate operations:
the same native function reuses its first wrapped capability identity. A named
function exported as `default` uses its function name as the operation; anonymous
default exports use `default`. Declare a shared function directly when all of
its aliases must carry the same effect policy. No new alias identity or
registry-copy mechanism is introduced by named defaults.

The chosen policy is part of the captured call identity alongside the module,
operation and argument digest. Later registration cannot alter an already
captured call, even on repeated dumps. Restore validates that identity. Changing
the live selection between capture and replay fails closed; it does not
downgrade a captured `read-side-effect` call, execute a replacement, or bypass
reconciliation by accepting a provider for a different invocation.

Recorded outcomes replay without invoking the host operation or reconciliation
provider. An unrecorded pending `re-issue` call can invoke the replacement again.
An unrecorded pending `read-side-effect` call instead requires a
`hostCallResumeProvider` proof matching the request's `callId`, `sourceHash`,
`moduleId`, `operation` and `argumentDigest`, plus the recovered outcome. Missing
or mismatched proof rejects with `HostCallResumabilityError` and action
`"external-reconciliation"`. A provider is responsible for genuine recovery of
the external effect; neither policy API makes arbitrary effects exactly-once.

A restored-invocation identity mismatch rejects at the public run boundary with
the actual `HostCallResumabilityError` class and `action: "reset"`, before invoking
a replacement or provider. This includes conflicts between an explicit function
policy and the captured named-policy default. `restore()` still validates the
snapshot and source before `run()` validates restored invocation identity;
snapshot/source validation errors are not reclassified as host-call errors.

Genuine native engine errors preserve their object identity, action, call ID and
lifecycle through synchronous throws, promise rejections and exception coercion.
They bypass guest catch/finally recovery, including Promise reactions, rather
than allowing a guest to suppress an inconsistent replay. Recognition requires
the canonical native constructor's private instance brand as well as normal
prototype identity. Names, `action` fields, constructor properties, copied
descriptors, prototype impostors and proxies of real errors do not carry that
brand. Ordinary host and guest errors remain catchable; cancellation retains
its existing catch/finally ordering and blocked host-capability admission.

A synchronous fatal host throw is not recorded as an ordinary rejected outcome,
matching the asynchronous path. If its failed-run checkpoint retains an issued
pending effect, restoring it follows the captured policy and requires external
reconciliation rather than replaying a downgraded guest error. Native error
identity is not serialized or reconstructed from untrusted checkpoint fields.
Legacy snapshot validation, immutable side-effect tags and schema are unchanged.

## External checkpoints during host waits

An independent embedding caller can request
`await dump(execution, { mode: "replay" })` using the original `run()` promise
while an injected host operation is still pending. This serializes the latest
yielded replay checkpoint without waiting for the operation to finish. If the
run has not yielded yet, the request waits for its first yield or completion.
No automatic snapshot backend is required. Restore the resulting JSON with
`restore(JSON.parse(saved), { source })` and pass that snapshot to `run()` with
the required capabilities and pending-operation recovery policies.

The default `mode: "capture"` retains next-yield behavior and rejects capture
while an injected host call is active. Replay mode also rejects requests made
from inside the same run's host callback, including after an asynchronous wait.
It does not serialize live native execution or promise objects: pending host
operations still require re-issue or genuine external reconciliation. The
signal dump handler selects replay mode for operator-requested checkpoints.
Completed and failed-run dumping retain their existing `onFailure` behavior.

## Raw views and serialized checkpoints

A raw snapshot passed to `SnapshotBackend.write(snapshot)` is not a deeply
frozen point-in-time value. Its shallow bindings can retain references to nested
objects that subsequent execution or cancellation cleanup mutates; copied
primitive bindings need not change with them. It is therefore not a uniformly
live view of the lexical environment either. Serializing a retained raw object
later can produce different diagnostic binding or heap fields.

Already serialized checkpoint bytes are a separate artifact: later source
mutations cannot change those bytes. The file backend serializes when its queued
write operation runs, before the filesystem write/retry loop. A later write can
replace a checkpoint file; retaining a raw object is not equivalent to retaining
the earlier file contents. Use the public dump/restore path for portable replay,
not a JSON clone of a live diagnostic view.

This distinction does not relax persisted-checkpoint correctness. Replay and
initial-input graphs, aliases, callback history, and fresh-process restoration
still need to describe the captured execution. The six checkpoint-view validation
profiles compare full serialized graphs and fresh restores, not just raw binding
observations; they are not a guarantee for every collection operation or old
snapshot.

### Canonical replay and outer projections

For current checkpoints containing canonical typed `replay`, that history supplies
restored outcomes and source-capability identities; the outer `bindings`/`heap`
and legacy `hostCalls` outcome projections are not lossless mirrors of that graph.
Legacy call identity/lifecycle and within-envelope references are still validated.
In the tested completed Map restores, function-marker aliases split across roots
and legacy marker names disappeared, while canonical typed identities and guest
results remained intact. These are real representation changes, not merely heap-ID
renumbering. They do not establish universal byte-identical dumps, whole-graph
stability after load/run/dump, or compatibility of legacy-only snapshots.

Migration reconciliation is bound to the exact checkpoint artifact, including its
outer fields (see [MIGRATION.md](MIGRATION.md)). A receipt for an earlier artifact
cannot transfer to a regenerated dump whose recorded fields differ, even if its
canonical replay graph is unchanged. Preserve the original artifact; inspect and
reconcile the artifact actually being migrated. Do not normalize references, edit
projection fields, or mutate the original to make artifacts or digests match.

## Execution and cancellation

Cancellation preserves the most recently captured checkpoint instead of replacing
its replay history with an unwind-time snapshot. Adding or removing an
`AbortSignal` on resume does not add promise-settlement events to that history.
Synchronous functions returning promises preserve those promises. Promise
reactions can consume settled host results; an explicit `await` creates an
await checkpoint.

Cancellation guards native capabilities at invocation boundaries without copying
their live result graphs. Aliased objects, captured constructor result objects,
and promise identities stay intact. A shared SDK promise can have a different
cancellation outcome in each run; those outcomes do not introduce new logical
promise identifiers into replay history. Sandbox callbacks remain distinct from
native capabilities so that source-level cleanup can run after cancellation.

Fatal budget and reentry rejections stop subsequent source execution and interrupt
pending promise waits even when a source handler ignores the rejection. Budget
unwinding still runs awaited `finally` cleanup and then rethrows the original
fatal error. Ordinary promise rejections, including aborted operations, retain
their normal handler behavior. This is not a recoverable-budget checkpoint policy;
that remains a separate language-completeness item.

Completed-run snapshots also retain portable replay history and original inputs.
Restoring one reuses the original random sequence and completed host outcomes,
rather than starting a new invocation at the final RNG state. Legacy snapshots
without recorded replay history retain their previous progression semantics.

Ordinary execution can still return opaque native functions or live host state.
If a completed host result lacks a resume capability, the returned snapshot has
a `replayError` diagnostic. Dumping or restoring it fails explicitly; the
runtime does not silently omit history and repeat external operations. Pending
checkpoint capture remains strict about unsupported values. These host-handle
limits are separate from reconstruction of source functions, which is supported.

The language-completeness plan in `docs/plans/safejs-language-completeness.md`
tracks outstanding release gates. This document describes the implemented
callback-recovery interface, not a claim that every checkpoint case is complete.

## Synchronous source generators

Replay can reconstruct a synchronous source generator by executing its source
and recorded history; it does not serialize an opaque native generator frame.
The background-dump generator-loop regression restores the source loop yielding
`1, 2, 3, 4` and returns the same `[1, 2, 3, 4]` result. This bounded example is
not a promise that arbitrary host iterators, async generators, or live native
frames can be checkpointed. Checkpoint timing and host recovery must still obey
the rules above.

## Original inputs and capabilities

Checkpoints retain the initial data supplied through bindings, imports, entry
point arguments, and import metadata, before source mutations. Replay uses that
saved data, not replacement values supplied by the caller. Data-only bindings or
imports may be omitted when resuming. Aliases, cycles, collections, and callable
property data are preserved within the captured graph.

Injected callable capabilities are rebound at their original input paths. The
caller must supply those capabilities again; their executable code is never
serialized. Capability paths use own properties, including explicitly recorded
collection positions, rather than prototype lookup. Initial input metadata and
required callable capabilities are validated before external reconciliation.

Injected promises use the host journal. Completed results can be restored
without the original promise object. A promise still pending at the checkpoint
requires external reconciliation under the `<inputs>` module ID; its operation
is the JSON-encoded input path. Supplying a new promise alone does not establish
the old operation's external outcome.

Source functions passed into native operations retain their source identity when
returned to the sandbox, including functions returned by asynchronous callbacks
or passed back as callback arguments. Replay reconstructs these functions from
source and resolves explicit per-invocation references. It does not execute
serialized native code. A returned function becomes available as soon as its
source reconstruction registers it, without waiting for an unrelated detached
callback to finish.
Nested native methods and function-valued properties use the same journaled
bridge as top-level bindings. Opaque native functions created by host operations
and live generators are not serialized by this codec.

## Local state during host replay

`declareHostOperation(operation, policy, { onReplay })` optionally registers a
synchronous local-state restoration hook. It receives the original invocation
arguments and the recorded outcome (`{ status: "fulfilled", value }` or
`{ status: "rejected", reason }`) when recorded replay delivers a completed
operation. It does not run for the original invocation or for a pending
operation that must be re-issued or externally reconciled. The hook must not
repeat external side effects or start asynchronous work. Throwing or returning a
promise aborts replay with `HostCallResumabilityError` requiring reset, rather
than leaving the interpreter waiting for an impossible settlement trace.

The paired harness uses this hook to reconstruct its built-in clock and shared
random generator while delivering saved host outcomes. Current checkpoints do
not require the legacy host-call sidecar to restore completed operations or
built-in time state. Custom `time` modules are not treated as the built-in clock
or generator. Cached asynchronous results in the sidecar remain promises rather
than becoming synchronous values.

## Callback history

Each native host invocation has its own callback identities. A callback can be
called repeatedly, invoked asynchronously, or returned from another callback.
The checkpoint records callback arguments before script mutations and orders
callback starts and completions with promise settlements.
For callback interactions, the execution trace also records AST node order so
competing continuations cannot exchange interpreter positions during replay.

During replay, saved callback invocations rebuild their script-side effects.
Nested host operations use the same host journal. Re-issuing a pending native
operation returns the replayed callback results to that operation instead of
executing its already-recorded callbacks twice. Changed callback arguments need
external reconciliation rather than silently mixing old and new execution.

## External reconciliation

`hostCallResumeProvider(request, context)` returns a `HostCallResumeProof`.
The proof must match the request's call ID, source hash, module, operation, and
argument digest. It supplies the recovered fulfilled value or rejected reason;
the provider is responsible for recovering the real external outcome without
repeating a non-idempotent operation.

When the operation has sandbox callbacks, the proof must also specify
`callbackDisposition`:

- `"joined"`: wait for callbacks in this invocation to finish before delivering
  the recovered operation result. Use this when the native operation awaits its
  callbacks. Callback rejection does not override an independently proven host
  outcome; the native operation may have handled that rejection.
- `"detached"`: deliver the recovered operation result without joining its
  callbacks. Use this only when that matches the native operation's semantics.

Omitting this field for an operation with callbacks raises
`HostCallResumabilityError` requiring external reconciliation. A recovered host
result alone does not establish whether its callbacks must finish first.

`HostCallResumeContext` provides:

- `callbacks`: a read-only map from callback IDs to callable host adapters.
  Calling an adapter from the resumer starts a **new** callback invocation after
  recorded execution has caught up to the checkpoint. This supports native work
  that had not invoked its callback before the checkpoint.
- `replayed`: the saved invocations, in invocation order. Each entry contains
  `callbackId` and a `result` promise for the reconstructed callback result.
  Await these promises to continue a native protocol after earlier callbacks;
  do not invoke those callbacks again through `callbacks`.
- `waitForCallbacks()`: wait for this invocation's active callbacks, including
  callbacks started while waiting. A `"joined"` proof performs this wait before
  the result is delivered.
- `toSandboxValue(value)`: convert a supported result graph for a proof in this
  active invocation's context. This includes genuine source-function adapters
  reconstructed through its callback history, with their supported aliases,
  cycles, and captures. It is not a general native-function import facility.

For a function-bearing callback result, await the appropriate `replayed` result
and convert that graph with the same context's `toSandboxValue`. Returning a
source function is not another callback invocation. Do not call the returned
function merely to replace it with data, or invoke the original callback again
to reconstruct a result already recorded. Conversion alone does not start a new
callback or invoke the reconstructed function. Request IDs, callback IDs,
invocation order, and the proof's required `callbackDisposition` still describe
the actual operation; conversion does not supply or replace that evidence.

The converter rejects ordinary native functions, function-shaped substitutes,
and functions from a different invocation context. It is valid only while its
own context is active. The generic `deepCopyToSandbox` converter continues to
reject native functions. These are context-scoped source-function guarantees,
not arbitrary closure serialization or a blanket promise about accessor
evaluation during all host conversions.

Source callback adapters retain lexical bindings. Host-observed wrapper `length`
also follows the guest signature in the tested direct-argument and array-property
paths, including default, rest, and bound signatures. This corrects the earlier
zero-length wrapper result; it does not imply universal function reflection,
descriptor, prototype, or function-property-write compatibility.

Replay data, callback arguments, and scheduling history count
against the aggregate data budget. Malformed callback journals or conflicting
execution traces are rejected before external reconciliation.
Retained source closures and their mutable captures remain budget roots even
after ordinary source bindings stop referencing them. Initial input history and
callback execution traces also consume the aggregate data budget.

## Collection identity and older captures

Current completed-outcome replay preserves the tested shared source function
across a Map key, its associated value, neighboring objects, and Set entries,
including cyclic captures. An older capture that already split these identities
does not contain enough information to recover the lost alias. Replaying such
a capture does not retrospectively repair it. Preserve the original evidence
and reconcile application state before an authorized reset or migration; do not
change a version marker to present it as a repaired capture. These graph-copy
checks do not establish parity for every Map operation.

## Argument digests and source `toJSON`

Host argument digests use an own-data representation rather than implicitly
calling a source `toJSON` hook in the tested plain-record, nested-record, and
named-array cases. The actual host argument graph is not replaced with that
digest representation. An explicit callback invocation by a host remains a real
invocation and must be recorded as such. This is a digest-construction guarantee,
not a claim that every conversion is free of accessor evaluation or user code.

Callable omission and the numeric-element array digest policy remain unchanged:
the digest is not a complete fingerprint of aliases or named array metadata.
Tested old plain/nested-object captures whose digest depended on `toJSON` refuse
with `does not match the next restored invocation; reset is required` before any
host operation or external proof provider runs. The tested old named-array
control still replays. Neither observation establishes a rule for every old
capture. A reset-required refusal is not authorization to repeat external
effects: reconcile their outcome before deciding whether to restart.

## Public results and thrown values

Callers must handle both fulfilled `run()` results and promise rejection. A
fulfilled result can have `ok: true` with a `returnValue`, or `ok: false` with an
interpreter diagnostic. Other failures reject the execution promise. Checking
only `result.ok`, or only catching a rejection, misses one channel.

These API channels are distinct from guest data. A guest that returns
`{ ok: false }` can still produce an API result with `ok: true`; inspect
`returnValue` according to the application's protocol. Inside source code,
catching and rethrowing ordinary records, including error-shaped records,
preserves their source identity, aliases, metadata, and visible mutations.
Host-boundary copying and public error normalization are separate operations;
a normalized public diagnostic is not a promise of identity with a guest object.

## Execution compatibility

The current marker also covers registered host methods returned by factories:
they retain their existing identity and can be rebound from snapshots without
recreating connections. Published poe-code 8.0.1 (`jobs-v4`) returns false for
`(await get()) === method` when `get` returns the registered `method`; the current
runtime returns true. Managed MCP clients use those stable capabilities and
run-scoped cleanup. Unsupported replay markers are rejected before effects, not
silently migrated.

New runs carry `executionSemantics: "jobs-v8"`. Guest function stringification
preserves the original function source, so source hashes include that observable
text (including comments and whitespace inside functions). Formatting outside
functions remains hash-insignificant. Host and bound functions expose native
function syntax, never their host implementation bodies.

The restore path also accepts genuine `jobs-v6` and `jobs-v7` snapshots and keeps
their execution semantics and original source-hash rules, including on subsequent
dumps. Their default function conversion remains opaque and does not gain the
new `toString` method; explicit guest conversion hooks still work. Accepting an
older marker is not an upgrade to v8. Explicit migration emits a fresh v8
continuation with its own source hash. Never rewrite a checkpoint's marker or
hash to opt into new behavior.

New run snapshots in poe-code 11.0.32 carried `executionSemantics: "jobs-v7"`.
Packaged working v6 histories have compatibility coverage,
while historical failing raw v6 histories remain separate evidence. Acceptance
does not guarantee that every v6 history can complete. Do not rewrite markers
to bypass this distinction.

Assignment references read their captured value before the RHS, and
conversion/write failures preserve source evaluation order. Unsupported earlier
markers require explicit migration rather than replaying host effects against
the corrected reference semantics. Promise jobs run after
the surrounding synchronous source execution yields. Async functions execute
their synchronous prefix before returning a promise, and synchronous builtin
callbacks do not implicitly await returned promises. Thenables preserve their
receiver, ignore settlement attempts after the first, and finish their current
synchronous invocation before await continuations execute.

The current marker includes the callable `Promise` constructor, its shared
prototype methods and receiver checks, and identity-preserving cancellation at
host boundaries. `jobs-v1` snapshots from poe-code 5.0.0 are incompatible: even
unchanged source such as `return typeof Promise` observes a different global.
They are rejected before host operations, not silently replayed under new rules.

The marker also covers function-scoped var/parameter bindings and separate body
environments when parameter expressions exist. `jobs-v2` snapshots from poe-code
6.0.0 can produce different results for unchanged source: a closure created in a
default parameter must not capture a subsequently declared body var. Published
6.0.0 fixtures reproduce this difference and three formerly failing redeclaration
cases. Such snapshots are rejected before any host effects, rather than silently
replayed with the corrected bindings. This remains rejection, not migration.

The marker also covers explicit agent result checking and error identity in
replay data. Published poe-code 7.0.2 (`jobs-v3`) snapshots reproduce a caught
exception where a fresh unchecked spawn now returns a result, and omit nested
aggregate failures that the corrected host bridge preserves. Such snapshots
are rejected before host effects. New error metadata records the original
constructor kind separately from mutable `name` fields; copies, heap snapshots,
and replay journals preserve this identity and reject invalid metadata.

These corrections change execution ordering, not the parsed source hash. An
upgrade probe against poe-code 4.0.71 reproduced both changed results and stalled
replay with an unchanged source hash. `restore` and `run` therefore reject replay
snapshots lacking a supported execution marker with `SnapshotValidationError`,
code `unsupportedVersion`, at `$.executionSemantics`, before host operations.
Unknown markers are also rejected. Legacy snapshots without replay history keep
their existing legacy restoration path; this does not upgrade their guarantees.

Keep older replay snapshots and their original source. Do not rename or inject
the version marker, or restart an effectful script merely to bypass this check:
neither operation establishes safe migration. The explicit continuation workflow
in [MIGRATION.md](MIGRATION.md) validates supported old journals, requires
digest-bound host quiescence and external-effect reconciliation, and transfers
selected application state without executing old frames. Use the original
runtime for formats outside that workflow's documented compatibility envelope.

Cancellation of builtin awaits is handled at the await boundary, without
replacing constructors or dropping their static properties and identity. Host
promises already wrapped for cancellation retain their original settlement
versus abort ordering. Source-function synchronous-prefix metadata survives
cancelable host round trips.
