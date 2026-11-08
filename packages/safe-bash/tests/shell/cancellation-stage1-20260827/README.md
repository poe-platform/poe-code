# Stage 1 private cancellation helper freeze

This directory freezes the private-helper contract before
`src/shell/cancellation.ts` exists. The freeze was authored against candidate
HEAD `290e175d19f065758b8586c79660fc927db65c9d` on 2026-08-27. The inspected
`src/shell/{cleanup,runtime,shell,types}.ts` and
`src/contracts/{command,command.md,io,output}.ts` blobs match design candidate
`618d8967009117547ab476256bc6eb0a9463309a` exactly. The design inputs at
`tests/commands/timeout-design-independent-20260827/{README.md,identity.json}`
remain read-only.

## Frozen private API

The future module is imported directly and is not a barrel or package export.
It provides `createRootCancellationLink`, `admitChildCancellation`,
`subscribeCancellation`, and pure `selectCancellationOutcome` operations.
Root and owned-child boundaries expose only their delivery signal, lineage,
ownership bit, and idempotent `close()`. A selection contains a return/throw
outcome and, only for cancellation-classified throws, an explicit private
provenance report. Reports carry no exit code, numeric status, observed command
result, or mutable parent status.

An omitted or explicitly undefined options argument, an absent `signal`, and an
explicitly undefined `signal` return a borrowed boundary. That boundary may be a
small lease object, but it allocates no controller, listener, subscription, or
report storage; its close is a no-op and cannot close its lineage owner.

Owned admission takes a caller-supplied bounded snapshot with actual invocation
depth, the existing `maxSubstitutionDepth`, and a finite resource limit. The
helper validates the snapshot but neither creates, resets, nor consumes a
`Budget`. Stage 2 must derive it from the already-admitted runtime state and
remaining existing command/depth constraints. The `resourceLimit` is explicitly
a helper-local verified bound, not a claim that a same-named current Budget field
exists. Parent subscription capacity and child-local capacity are checked before
listener admission; failed initialization rolls back every admitted listener and
subscription.

## Frozen precedence and lifecycle policy

Admission precedence is the best already-aborted ancestor (root caller, then
outermost invoke option, then the first delivered control origin), the parent's
stable closed-admission error, a staged container/property/brand failure, then a
local pre-abort. An ancestor already aborted at entry prevents any options
lookup. If a getter closes the parent, the stable closed error beats the staged
getter result. `options.signal` is read once by ordinary lookup. Arrays,
functions, inheritance, accessors, and proxies therefore retain normal language
effects; only a native-branded AbortSignal or undefined is accepted.

First delivery is immutable. Selection may improve from inner to outer to root
while a boundary remains open. Closing fixes that boundary's outcome, detaches
each owned listener/subscription exactly once, clears retained callback state,
and returns the same close report on every call. A later ancestor event cannot
rewrite a closed delivery or selection.

At a boundary, root caller wins first. An unrelated captured rejection wins over
invoke-option cancellation and remains exact, including undefined and other
falsy values. Otherwise the outermost aborted invoke origin wins; otherwise an
explicitly reported descendant cancellation or exact local cancellation is
preserved; otherwise the numeric return is preserved. Budget and pipeline
control failures are classified for propagation but remain unrelated execution
failures for invoke-deadline replacement. All comparisons use `Object.is`.

The design proposal's shared reason array is insufficient for concurrent
siblings that use the same primitive reason. This freeze instead requires an
explicit report object from the exact captured child boundary. The pure selector
does not mutate or poison a parent, and an omitted, mismatched, handled, or
unrelated sibling report cannot classify another outcome. This is provenance,
not an observed-status channel.

Subscriber fanout is synchronous. A failing subscriber is caught, detached, and
recorded once. `close()` returns exact callback/lifecycle failures, including
undefined, without rejecting child close or changing its selected outcome.
Stage 2 must synchronously register an idempotent closure with the existing
InvocationScope before acquisition and append those failures to the existing
root cleanup accumulator. This helper neither integrates cleanup nor changes
Shell settlement.

## Scope and chronology

The executable tests, literal `cases.json`, negative type fixture, and isolated
strict/build configurations were written before helper implementation. The
initial scoped execution is expected to fail only because the future module is
absent; `BASELINE.md` preserves that raw result. `freeze-manifest.json` binds the
meaningful fixture bytes. Any correction requires a new version beside these
bytes and an explicit rationale; these expectations must not be silently edited.

No native command oracle, DU cohort, Runtime/Shell integration, timeout command,
public export, root configuration, package file, or existing source/test file is
in scope. Stage 2 requires a different review and must preserve the existing
shared Budget, InvocationScope cleanup barrier, streams, middleware, and command
admission.
