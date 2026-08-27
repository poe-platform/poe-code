# Checkpoint replay and host callbacks

Recorded checkpoints contain the initial random state, portable host results,
callback arguments, and an execution-order trace. Restoring a checkpoint rebuilds
script state from the source and replays that history. Completed host operations
are not invoked again. A still-pending operation follows its declared recovery
policy: re-issue or external reconciliation.

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

Callback adapters retain the source's lexical bindings. They do not grant access
to host globals. Replay data, callback arguments, and scheduling history count
against the aggregate data budget. Malformed callback journals or conflicting
execution traces are rejected before external reconciliation.
Retained source closures and their mutable captures remain budget roots even
after ordinary source bindings stop referencing them. Initial input history and
callback execution traces also consume the aggregate data budget.

## Execution compatibility

New run snapshots carry `executionSemantics: "jobs-v3"`. Promise jobs run after
the surrounding synchronous source execution yields. Async functions execute
their synchronous prefix before returning a promise, and synchronous builtin
callbacks do not implicitly await returned promises. Thenables preserve their
receiver, ignore settlement attempts after the first, and finish their current
synchronous invocation before await continuations execute.

The `jobs-v3` marker includes the callable `Promise` constructor, its shared
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

These corrections change execution ordering, not the parsed source hash. An
upgrade probe against poe-code 4.0.71 reproduced both changed results and stalled
replay with an unchanged source hash. `restore` and `run` therefore reject replay
snapshots lacking the current execution marker with `SnapshotValidationError`,
code `unsupportedVersion`, at `$.executionSemantics`, before host operations.
Unknown markers are also rejected. Legacy snapshots without replay history keep
their existing legacy restoration path; this does not upgrade their guarantees.

Keep older replay snapshots and use the runtime that created them. Do not rename
or inject the version marker, or restart an effectful script merely to bypass
this check: neither operation establishes safe migration. Explicit migration
and external-effect reconciliation remain a separate language-completeness item.

Cancellation of builtin awaits is handled at the await boundary, without
replacing constructors or dropping their static properties and identity. Host
promises already wrapped for cancellation retain their original settlement
versus abort ordering. Source-function synchronous-prefix metadata survives
cancelable host round trips.
