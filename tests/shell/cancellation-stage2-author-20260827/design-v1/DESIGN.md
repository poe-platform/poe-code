# Stage 2 child-cancellation integration map — HOLD

Status: author design only, 2026-08-27. Product writes, executable tests, and
cohorts remain on hold until Poincare's independent preintegration freeze and
root release. This design adds no timeout command, public default, status
channel, deadline counter, or `Budget.timeouts` API.

## Bound current baseline

The inspected tracked source, reverified again at current `HEAD`
`ebd77c05134bc77311609e02cf4a35c8aff0fcc2`, is clean for every proposed source
seam. The intervening concurrent HEAD movement did not change any bound source
blob. `src/contracts/{command.ts,command.md}` and
`src/shell/{types.ts,runtime.ts,shell.ts,cleanup.ts}` have exactly the accepted
getopts snapshot `618d8967009117547ab476256bc6eb0a9463309a` blobs.
Owned-output commit `eba049535d154f4e028f57ffd8efd7622b2239ca` is an ancestor
of 618 and remains a required behavioral provenance, but its transitional
`runtime.ts` and `shell.ts` blobs differ from current; current planning therefore
uses the 618/current lines, including the owned-output paths now present there.
The current private helper exactly matches accepted repair `fbbe1ef7`.

## Additive option contract

Add only `readonly signal?: AbortSignal` to `CommandInvokeOptions` and the
matching `ShellInvokeOptions`. It is the original child signal, not a controller
or a composed signal. Its authority covers the selected child invocation and
that child's descendants. It never cancels or closes its parent, sibling,
unrelated pipeline stage, or another shell.

Omitted and explicitly undefined options retain the existing path. Absent and
explicitly undefined `signal` use the helper's borrowed boundary: a small lease
object is permitted, but no cancellation controller, listener, subscription, or
report storage is created. This guarantee does not erase the child invocation's
already-existing `InvocationScope`, state, stream, middleware, and budget work.
For objects/functions/arrays, ordinary `options.signal` lookup occurs exactly
once; inherited accessors and Proxy traps retain ordinary effects. Those caller
effects are excluded from any zero-side-effect statement.

Admission order is exact:

1. Check an already-aborted ancestor before touching the options container or
   getter; its exact reason wins.
2. Stage container, getter, and native-brand failures, recheck the ancestor,
   then publish the staged failure. A valid pre-aborted local signal follows
   the same ancestor recheck and otherwise rejects by exact local reason.
3. Complete this gate before `parent.child()`, middleware, dispatch, VFS, input,
   sink, or owned-output acquisition. Do not reset or replace the shared budget.
4. Only a native-branded `AbortSignal` or undefined is accepted. No reason-name,
   errno, truthiness, or signal-shaped-object test substitutes for the brand.

## Preintegration mechanism proposals — not frozen

These are concrete answers for root/Poincare review, not an API freeze or source
authorization. The recommendation is the smallest mechanism that does not infer
provenance from an equal rejection value.

### 1. Control-bearing child lineage

Recommended helper extension: retain `admitChildCancellation` unchanged for its
accepted callers and add the following private, one-shot preparation seam in
`src/shell/cancellation.ts`:

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
```

The actual type is opaque/private. Preparation performs the existing ancestor,
container, single `options.signal` getter, native-brand, pre-abort, snapshot, and
capacity validation but allocates no controller and attaches no parent
subscription or signal listener. Activation is synchronous, may be called once,
rechecks the parent, capacity, and every original signal, then either returns a
borrowed boundary or allocates and attaches one child link with rollback on any
partial failure. Existing `admitChildCancellation(parent, options, snapshot)`
can remain the compatibility spelling of prepare-then-activate with an empty
control list.

`options.signal` alone creates the frame's `invoke-option`; its frame depth is
the invoke settlement rank. `controls` contains only original
`budget-control`/`pipeline-control` signals and never changes that rank. Pipeline
derivation passes its original stage controller in configured stage-local order,
not `AbortSignal.any(...)` or `commandSignal.reason`. The link subscribes only
downward to its parent, so a child cannot publish into a parent or sibling. It
owns and detaches its own control listeners and parent subscription. Close fixes
its selected/delivered origin and ignores later publications.

The same existing admission accounting applies: the child controller and each
non-aborted local control/listener consume the child snapshot; the one parent
subscription is admitted against the parent. Depth/maxDepth remain the existing
lineage bound. No `Budget` counter, reset, timeout slot, or global registry is
added. Among controls, actual post-listener delivery wins; only multiple controls
already aborted when observation begins use configured order. Later control
delivery cannot rewrite the delivery origin.

Tradeoff: widening `createRootCancellationLink` or re-rooting each pipeline from
a composed signal is fewer names, but it either cannot append a nested control or
erases its original frame/role. Duplicating the helper's validation in
`runtime.ts` would also risk admission-order drift. Freeze the exact two private
signatures, one-shot behavior, resource formula, control order, rollback, and
holdouts separately before any helper edit.

### 2. Exact rejection plus private outcome transport

Recommended runtime mechanism: an owned cancellation frame has a private local
`InvokeOutcomeRecord` set. Each record binds one exact `Promise<CommandResult>`
object to the child's eventual `CancellationReport`; the record is not keyed by
the reason and is never attached to, returned in, or encoded around the public
reason. `Runtime.invoke` creates the record only for an owned cancellation link,
binds the exact promise returned by the `context.invoke` closure, and finalizes
the record only after `invokeScoped` has settled, its input and child scope have
closed, the boundary has closed, and `selectCancellationOutcome` has produced a
report. The public promise still rejects with `selection.outcome.reason` exactly.

The proposed private runtime-only shape is:

```ts
interface InvokeOutcomeRecord {
  readonly promise: Promise<CommandResult>;
  readonly boundary: CancellationBoundary;
  finalized: boolean;
  consumed: boolean;
  selection?: CancellationSelection<CommandResult>;
}

interface InvokeOutcomeChannel {
  bind(
    promise: Promise<CommandResult>,
    boundary: CancellationBoundary,
  ): InvokeOutcomeRecord;
  finalize(
    record: InvokeOutcomeRecord,
    selection: CancellationSelection<CommandResult>,
  ): void;
  consume(
    rawReturn: unknown,
    capturedReason: unknown,
  ): CancellationReport | undefined;
  discard(record: InvokeOutcomeRecord): void;
  close(): void;
}
```

`consume` succeeds only when the unconsumed finalized record has
`rawReturn === record.promise`, a throwing selection whose exact reason is
`Object.is`-equal to `capturedReason`, and a helper-authenticated report. Promise
identity plus ownership authenticates the route; equality is only a consistency
check after that authentication and is never sufficient by itself.

A report is consumable only at the runtime call boundary that owns both the
record and the raw returned promise. That boundary must observe
`rawReturn === record.promise` before promise assimilation and must observe that
same promise reject. It then supplies that report with its captured throw to the
enclosing `selectCancellationOutcome`. Consumption is one-shot; finalization or
boundary close discards unconsumed records. Different sibling records remain
distinct even when their reasons are the same primitive. A caught child promise,
a replacement value/promise, or a separately thrown equal primitive does not
consume the record and therefore remains handled or unrelated. Borrowed frames
allocate no record and cannot write into the parent's set; they may only
transparently carry a record already authenticated at an owned runtime boundary.

The actionable sites are the `dispatchScoped` `context.invoke` closure, the raw
registry `definition.execute(...)` return, each runtime-owned middleware adapter,
`Runtime.invoke`/`invokeScoped`, `shebangStage`'s invoke closure, and the explicit
`envShebang` forwarding catch. The final execution capture remains a
`{kind:"return"}`/`{kind:"throw", reason, report?}` discriminant, so falsy values
remain exact. No `WeakMap` or `Map` keyed by reason is permitted.

There is an irreducible limit in the current public chain. `composeMiddleware`
and an `async` command/middleware can adopt the invoke promise and reject with
the same arbitrary primitive through a different Promise object. Catching and
rethrowing that primitive is observationally identical at the outer runtime
boundary to an unrelated throw of the same primitive. `Object.is` cannot prove
causality. The safe narrow contract therefore authenticates only unchanged raw
promise pass-through at runtime-owned call boundaries; transformed/adopted user
JavaScript rejection is unrelated unless an independently frozen explicit
provenance capability is added. This produces safe false negatives rather than
handled-child poisoning, but it cannot promise ranked invoke dominance through
arbitrary `async` user code.

Root must freeze one of two choices before code: (A) accept that narrow support
contract, recommended because it preserves the current public API and exact
reason identity; or (B) authorize and specify an explicit report-aware internal
handler/middleware capability and its propagation rules. Choice B cannot be
silently simulated with reason wrapping, promise decoration, equality matching,
or a global reason table, and may expand the minimum source write-set. It is not
authorized by this design.

### 3. Two-phase ownership and settlement

Recommended runtime seam: a private `InvocationCancellationOwner` is created
around an inert prepared admission. It has an admission-open flag, one shared
finalization promise, and idempotent `requestClose()`/`finalize()` operations.
It is runtime state, not a new public option and not an `InvocationScope` change.
The proposed runtime-only shape is:

```ts
interface InvocationCancellationOwner {
  readonly finalized: Promise<void>;
  assertAdmissionOpen(): void;
  activate(prepared: PreparedChildCancellation): CancellationBoundary;
  requestClose(): void;
  finish<Value>(
    childBarrier: Promise<void>,
    captured: CapturedCancellationOutcome<Value>,
  ): Promise<CancellationSelection<Value>>;
}
```

`finish` owns the barrier-then-close-then-select sequence and shares one result
across overlapping callers. For a root owner, construction supplies the already
created root boundary instead of calling `activate`; this is an internal factory
variant, not another public option.
The exact sequence is:

1. Check the ancestor/owner-open state; validate the invoke argument/options
   container, read `signal` once, validate native brand and snapshot, and stage
   any local failure. Recheck the ancestor before publishing that failure. No
   child scope, input, middleware, VFS, sink wrapper, controller, listener,
   subscription, or report record exists yet.
2. If preparation is borrowed, use the existing invocation-scope path with no
   cancellation owner, controller, listener, subscription, or outcome record.
   The already-existing child `InvocationScope` allocation remains and is not
   represented as cancellation work.
3. For an owned preparation, synchronously register one owner callback on the
   enclosing scope before `parent.child()` and before activation. The callback
   sets admission closed and awaits the same owner finalization promise. A
   registration failure leaves the preparation inert. There is no `await`
   between successful registration, child-scope creation, and activation.
4. Create the existing child scope, activate the prepared link, and recheck the
   parent/local/control signals. On activation failure, roll back every partial
   listener/subscription, close any created child scope, append detach failures
   to its shared cleanup-failure array, finalize the owner, then publish the
   already-ranked ancestor or staged exact failure.
5. Run through the current shared Budget, state, byte streams, middleware,
   dispatch, shebang, and input paths. Capture return/throw explicitly. A close
   request blocks new nested admission through the owner flag, but the boundary
   keeps observing original signals while admitted cooperative work drains.
6. Await `invokeScoped`'s existing input `finally`, then await the existing child
   `InvocationScope.close()` promise without racing it against an abort or
   timeout. Its callbacks and descendant scopes may run concurrently exactly as
   `cleanup.ts` currently specifies. Ordering is provided outside that class:
   the enclosing-scope owner callback waits for finalization, while the invoke
   path waits for the child scope barrier and only then finalizes the boundary.
7. After that barrier, call `boundary.close()` once, append every exact close
   failure to the existing shared cleanup accumulator, detach, select the fixed
   outcome, finalize/consume the private record, and resolve the owner promise.
   Only then may the invoke promise settle. A parent close/dispose waits the
   registered owner callback; overlapping normal-finally/close/dispose paths
   share the same completion.

This enclosing-owner seam avoids making one cleanup callback wait on its own
`InvocationScope.close()` and avoids relying on callback order, which would
deadlock or race because current callbacks start concurrently. The private,
unique `scope.signal.reason` created by normal scope sealing is lifecycle
interruption only; it is authenticated by that exact scope/owner and cannot be
classified as caller or invoke cancellation. Normal close therefore cannot
masquerade as a caller abort. Caller, budget, invoke, and pipeline origins still
come only from their original signals.

Root `Shell.exec` uses the same owner state with a non-self-waiting root slot:
register an inert callback on the root scope before
`createRootCancellationLink` acquires listeners; that callback only seals root
admission/requests finalization and does not await the scope whose callback is
running. `exec` awaits `scope.close()`, then closes/selects the root boundary and
resolves `owner.finalized`. The existing active-exec record retains the owner so
`dispose` awaits both `scope.close()` and `owner.finalized`; it cannot settle in
the microtask gap between them. Root caller remains separate from the original
`budget.controller.signal`; passing only `budget.signal` is forbidden because
`AbortSignal.any()` loses provenance.

Boundary-close failures join the existing cleanup accumulator; no callback is
skipped because another fails. At the public root barrier the order remains:
exact root caller > selected execution rejection > sole cleanup failure or
ordered `AggregateError` > numeric result. At an invoke boundary it remains root
caller > authenticated unrelated execution rejection > outermost-to-innermost
invoke cancellation > reported cancellation/return. First delivery is immutable
while ranked selection may improve only until close. No owned-cleanup promise is
abandoned with `Promise.race`, and no opaque handler, middleware, input, sink,
filesystem, JavaScript loop, or OS process gains a new drain obligation.

Tradeoff: registering boundary close directly on the child scope is smaller but
runs concurrently with child callbacks and freezes selection too early. Closing
only in `finally` omits the public disposal barrier. The enclosing owner adds one
private promise/slot only for owned links and supplies the required ordering
without editing `cleanup.ts`. Freeze this protocol, especially activation
rollback, lifecycle-reason classification, accumulator ordering, and disposal
participation, before implementation.

## Runtime provenance and preserved behavior

`Runtime` retains the private boundary/owner beside its existing execution
signal. Pipeline runtimes append the original per-stage controller as
`pipeline-control`; dispatch, nested invoke, shebang/interpreter/direct-script,
and `/usr/bin/env` paths forward the same lineage. No path reconstructs origin
from a composed signal's reason.

Shared `Budget` identity and its `commands`, `iterations`, `bytes`, and
`sourceBytes` counters remain unchanged. Filesystem, registry, middleware,
file-write/output-file maps, literal argv, cwd/env replacement, shell state,
depth accounting, stdin cursor and `stdinIsDefault`, Uint8Array streams,
backpressure, output ownership, diagnostics, pipefail, and numeric status
semantics remain on their current paths. The helper-local finite admission bound
uses safe saturating arithmetic from remaining `maxCommands`, actual child depth,
`maxSubstitutionDepth`, and fixed original-control slots. It is neither a mutable
Budget counter nor a reset; the exact formula is part of the separate freeze.

## Minimum proposed source map

- `src/contracts/command.ts:4-12`, `CommandInvokeOptions`: add the optional
  readonly child signal only.
- `src/contracts/command.md`, after the literal-invocation invariants and without
  changing cleanup text: document descendant isolation, native admission,
  exact-reason selection, and closure-before-settlement.
- `src/shell/types.ts:3-11`, `ShellInvokeOptions`: mirror the contract field.
- `src/shell/shell.ts:87-105`, `Shell.exec`, and `:108-155`, `#execute`: seed
  original root/control provenance, retain the post-drain original caller check,
  and close/detach the root boundary only after the registered cleanup tree.
- `src/shell/runtime.ts:339-349`, `Runtime` constructor: retain the boundary;
  `:414-480`, `pipeline`: preserve original stage controls; `:890-920`, dispatch
  context: forward lineage; `:1258-1369`, shebang/env forwarding: retain options
  and lineage; `:1563-1605`, `invoke`/`invokeScoped`: perform pre-scope admission,
  capture, cleanup barrier, boundary close/report, and exact reselection.

No `cleanup.ts`, output contract, barrel, package, root export, timeout family,
configuration, or Budget API edit belongs in this minimum map. New executable
tests will be author-owned only after release; no existing/frozen test is edited.

## Required separate freezes and root decisions

The accepted helper is not pre-authorized for change. Stage 2 remains held until
root routes these exact questions to Poincare and records a decision:

1. Freeze or reject the private `prepareChildCancellation` plus
   `activateChildCancellation` extension, including control order, one-shot
   activation, accounting, rollback, and compatibility behavior. No helper code
   may precede this separate API/holdout freeze.
2. Choose outcome transport A (recommended narrow raw-Promise authentication)
   or authorize outcome transport B with an explicit provenance capability and
   expanded write-set. The freeze must state that equal arbitrary values alone
   are never causal evidence and whether ranked invoke dominance is intentionally
   limited across transformed arbitrary user async code.
3. Freeze the enclosing `InvocationCancellationOwner` protocol: inert
   registration slot, admission seal, activation rechecks, child cleanup barrier,
   boundary close/select/finalize order, disposal wait, failure accumulation, and
   lifecycle-only scope-close reason.

These are mechanisms with stated tradeoffs, not questions that product code may
answer implicitly. Re-rooting composed signals, hidden wrapping/decoration, a
reason-keyed table, child-to-parent cancellation publication, early boundary
close, or cleanup abandonment are not admissible substitutes.

## Future Poincare holdout map — do not execute now

- Backward compatibility/types: omitted and explicit-undefined options; absent
  and explicit-undefined signal; readonly valid signal; negative `null`, plain
  signal-shaped object, controller, and primitive rows in both public/internal
  option interfaces; no result or other option type change.
- Admission: ancestor pre-abort skips getter; getter read once and exact thrown
  identity; invalid container/brand and local pre-abort create no child scope,
  middleware, VFS, stream, handler, or owned-output work; ordinary Proxy/getter
  effects are explicitly outside zero-side-effect claims.
- Provenance/selection: nested inner/outer/root schedules, immutable first
  delivery versus ranked settlement, explicit reports, equal primitive reasons,
  handled cancellation, concurrent siblings, parent/sibling/other-shell
  isolation, configured-order fallback only for multiple pre-observed aborts,
  and fixed closed-boundary outcomes.
- Path coverage: direct registry invocation, middleware, nested invoke,
  multi-stage pipeline and early close/pipefail, virtual script/interpreter,
  and `/usr/bin/env` shebang forwarding all retain original origins and current
  state/stream/status behavior.
- Cleanup/owned output: cleanup registration precedes acquisition; admitted work
  drains; boundary failures join the existing accumulator; listeners detach
  before invoke/public settlement and disposal; blocked enrolled owned-output
  work cooperates without closing sibling destinations or the parent context.
- Precedence: local caller > unrelated execution > ranked invoke cancellation;
  public caller > execution > cleanup > numeric; falsy/errno-shaped reasons and
  late losing rejections; no cancellation-to-timeout status mapping.

Poincare's independent scope is
`tests/shell/cancellation-stage2-independent-20260827/**`; this author design
does not inspect, edit, run, or claim results from it.
