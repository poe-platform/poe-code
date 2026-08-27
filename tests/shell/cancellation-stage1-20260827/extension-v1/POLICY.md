# Private cancellation helper extension freeze

This extension is frozen before changing `src/shell/cancellation.ts`. It adds
three private-module APIs and does not change the accepted Stage 1 APIs or their
selector semantics:

```ts
interface PreparedChildCancellation {
  readonly owned: boolean;
}

function prepareChildCancellation(
  parent: CancellationBoundary,
  options?: CancellationInvokeOptions,
  snapshot?: CancellationAdmissionSnapshot,
  controls?: readonly CancellationControlOriginInput[],
): PreparedChildCancellation;

function activateChildCancellation(
  prepared: PreparedChildCancellation,
): CancellationBoundary;

function selectRuntimeCancellationOutcome<Value>(
  boundary: CancellationBoundary,
  captured: CapturedCancellationOutcome<Value>,
  observedOrigin?: CancellationOrigin,
): CancellationSelection<Value>;
```

`PreparedChildCancellation` is opaque apart from `owned`. Preparation is
synchronous and inert. It checks the best already-aborted ancestor before any
options lookup, reads `options.signal` at most once by ordinary lookup, validates
native signal brands, and, when ownership is required, copies and validates the
controls and admission snapshot and preflights current capacity. It creates no
controller, listener, subscription, report, or global entry. Omitted and
explicitly undefined options, an absent signal, and an explicitly undefined
signal with no controls prepare a borrowed activation even if a snapshot was
supplied. Explicit undefined is accepted for each optional argument.

A local signal or at least one control requires an owned frame and a valid
advancing snapshot. Only the local signal creates an `invoke-option` rank.
Control-only frames do not invent one. Original `budget-control` and
`pipeline-control` signals are copied in configured order and keep their roles
and child frame. Required child capacity is one controller plus one listener for
each non-aborted local signal/control. The parent subscription is separately
preflighted against the parent. There is no reservation during preparation and
no Budget, timeout, deadline, global counter, or opaque-work guarantee.

Activation is one-shot. Every repeat throws the prepared object's stable replay
error. Before allocation it rechecks ancestor abort/parent closure, current
capacity, and the original local/control signals. Parent lineage wins by the
existing root, outer invoke, then delivered/configured-control rules; local
invoke wins over local controls; already-aborted local controls use their copied
configured order. A failure before or during initialization rolls back every
admitted listener and parent subscription. Actual listener-time publication
keeps first delivery while ranked selection may improve. Owned close remains
idempotent and downward-only. Borrowed activation creates no cancellation
resources and borrowed close cannot close the parent.

The owner must synchronously register its idempotent cleanup before activation.
The helper does not implement or simulate `InvocationCancellationOwner` and
cannot enforce registration in an arbitrary host. The author test uses a local
registrar solely to prove ordering, failure closure, exact invocation/Promise
identity, one-shot report consumption, and disposal at an ordinary
error-to-status mapping.

`selectRuntimeCancellationOutcome` is deliberately stricter than the accepted
Stage 1 selector. Root caller remains highest. A supplied `observedOrigin` is
accepted only by exact object identity when it is a visible member of the exact
helper-owned boundary lineage and its reason is `Object.is`-equal to the captured
throw. Supplying it is the trusted runtime callsite's assertion that its
cancellation branch actually won; helper lineage validation alone does not and
cannot observe that Promise race. A helper-authenticated descendant report is
also accepted only for its exact target and reason. Otherwise an escaping throw
is unrelated, even when its value is equal, falsy, or `NaN`-equal to a visible
cancel reason. No reason-keyed map, public wrapper, Promise decoration, or
transparent provenance through arbitrary async functions exists.

The test-local registrar binds a report to an exact invocation object, exact raw
Promise object, exact boundary, and exact rejected value only after those
identity checks. Equality is a consistency check after identity authentication,
never proof by itself. Consumption is one-shot. Handling, replacement,
finalization, ordinary error-to-status mapping (R08), or close discards the
record. A sibling, adopted/replacement Promise, separately thrown equal value,
numeric status, or mapped error cannot transfer a report or poison a borrowed
parent. R09/R10 remain future integrated cases where outer/root actually abort.

The extension does not edit Runtime, Shell, contracts, public types/exports,
cleanup, input/output, package/configuration, Stage 2 files, or frozen Stage 1
files. Integrated behavior is not executed or claimed. Runtime-owned
`InvocationCancellationOwner` remains design-only and needs a different review.

