# Checkpoint replay and host callbacks

Recorded checkpoints contain the initial random state, portable host results,
callback arguments, and an execution-order trace. Restoring a checkpoint rebuilds
script state from the source and replays that history. Completed host operations
are not invoked again. A still-pending operation follows its declared recovery
policy: re-issue or external reconciliation.

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
