# Child-scoped cancellation and `timeout` design proposal

Status: proposal only, 2026-08-27. No product, test, export, package, or
configuration change is authorized or implemented here. The authoritative
product snapshot is commit `618d8967009117547ab476256bc6eb0a9463309a`.
The inspected tracked files at live `HEAD` have the same bytes as that snapshot;
the reserved runtime therefore was not read from an unstable worktree.

## Finding

The exact missing seam is one optional property:

```ts
export interface CommandInvokeOptions {
  // existing properties unchanged
  readonly signal?: AbortSignal;
}
```

`ShellInvokeOptions` must have the same optional readonly property. The value is
an `AbortSignal`, never an `AbortController`. Although the property is named
`signal`, its authority is descendant-local: it applies to the selected child
invocation and invocations descended from that child. It must not abort or close
the parent, a sibling invocation, another pipeline stage, or another `Shell`.

This is additive. Omitting `signal` must take the current path without a new
controller, listener, shell, budget, stream, middleware chain, or state reset.

## Accepted root profile decisions

- The initial `timeout` profile rejects `--preserve-status` with status 125,
  exactly like the unsupported native signal/process-control flags. There is no
  observed-status channel, public or private, and no fabricated 143 or 137.
- Mathematical duration zero disables the deadline. Decimal scaling is exact,
  milliseconds are ceiled once, and positive deadlines use the accepted chunked
  monotonic cooperative scheduler described below.
- `Budget` has no timeout/deadline counter and no `Budget.timeouts` API. Deadline
  cancellation is delivered by `AbortSignal`; it does not consume or reset an
  invented global work/deadline budget.

Snapshot facts:

- `CommandInvokeOptions` has no signal at `src/contracts/command.ts:4-12`.
- The duplicate internal shape has no signal at `src/shell/types.ts:3-11`.
- `Runtime.invoke` creates a child `InvocationScope`, reuses the same `Budget`,
  middleware, file-write map, and output-file map, and currently retains the
  ancestor `commandSignal` at `src/shell/runtime.ts:1563-1567`.
- `invokeScoped` preserves literal argv, cloned shell state, selected cwd/env,
  stdin provenance, and sink overrides at `src/shell/runtime.ts:1570-1604`.
- The root public barrier closes the invocation tree before checking the exact
  shell caller reason at `src/shell/shell.ts:87-105`.
- `InvocationScope.close` synchronously seals admission, recursively closes
  children, starts all registered cleanup, and shares one drain promise at
  `src/shell/cleanup.ts:39-58`.

## Normative child-signal contract

### Exact option admission

This addition does not broaden validation of `stdin`, sinks, cwd, env, or the
other existing invoke properties. It makes only the options container and the
new property precise:

1. An omitted third argument and an explicitly `undefined` third argument both
   select the existing empty-options path. An absent `signal` property and a
   present property whose value is `undefined` both disable the new seam.
2. With no already-aborted ancestor cancellation, `null` or a non-object,
   non-function options value rejects the returned promise with `TypeError`.
   Arrays and functions use ordinary JavaScript property lookup; TypeScript
   still rejects them structurally when they do not satisfy the interface.
3. Read `options.signal` exactly once by ordinary JavaScript lookup. This
   deliberately preserves inherited properties, accessors, and Proxy behavior.
   With no higher-priority ancestor, a throwing getter rejects with that exact
   thrown value. The runtime cannot promise zero effects performed by user
   getters or Proxy traps.
4. A value other than `undefined` must pass the native `AbortSignal` brand check
   (the `AbortSignal.prototype.aborted` getter applied to the value is the
   concrete check). Brand failure rejects with `TypeError`; a lookalike with
   `aborted`, `reason`, or event methods is not accepted.
5. Stage any container/property/brand failure, recheck ancestor priority, and
   only then publish the staged failure or inspect local pre-abort. A pre-aborted
   ancestor wins by its exact reason over a malformed options value, invalid
   signal, getter failure, or pre-aborted local signal. If the ancestor is already
   aborted at entry, do not read `options` at all. Otherwise, a pre-aborted valid
   local signal rejects with its exact reason.

All of those checks precede `parent.child()`. Invalid or pre-aborted admission
therefore creates no command scope and admits no middleware, command resolution,
VFS, stream, handler, or owned-output work. After this narrow gate, existing
name/argv and existing option-property validation/order remain unchanged. The
negative type rows are `signal: null`, a plain signal-shaped object, a controller
instead of its signal, and non-`AbortSignal` primitives; the runtime rows also
cover null/non-object options, inherited/explicit-undefined signal, a getter read
once, getter-thrown identity, ancestor-pre-abort priority, and zero admission.

### Private recursive provenance and delivery

A composed signal records only its first reason, so checking
`parent.commandSignal.reason` cannot implement recursive priority. The proposed
runtime path carries a private, non-exported linked record instead:

```ts
type PrivateCancellationRole =
  | "root-caller"
  | "invoke-option"
  | "budget-control"
  | "pipeline-control";

interface PrivateCancellationOrigin {
  readonly role: PrivateCancellationRole;
  readonly signal: AbortSignal;       // original, never a composed replacement
  readonly frame: PrivateCancellationLink;
  readonly settlementRank: "root" | "invoke" | undefined;
}

interface PrivateCancellationLink {
  readonly parent?: PrivateCancellationLink;
  readonly rootCaller?: PrivateCancellationOrigin; // root link only
  readonly localInvoke?: PrivateCancellationOrigin; // non-root link only
  readonly controls: readonly PrivateCancellationOrigin[];
  readonly deliverySignal: AbortSignal;
  delivered?: PrivateCancellationOrigin; // immutable after first delivery
  selected?: PrivateCancellationOrigin;  // may improve by settlement rank
  readonly reportedDescendants: PrivateCancellationOrigin[];
  subscribe(listener: () => void): () => void;
  close(): void;
}
```

The concrete settlement ranking is: original root caller first; then invoke-option
origins from outermost frame to innermost frame. Budget and pipeline-control
origins participate in cooperative signal delivery and exact classification but
have no settlement override rank. Normal `InvocationScope.#controller` closure
is intentionally not an origin: it seals/drains a scope and must never be
misclassified as caller abort or override a normal return.

`Shell.#execute` must seed the root link with the original `options.signal`, not
only `budget.signal`, plus the original `budget.controller.signal` as an existing
control origin. Pipeline runtimes append their original per-stage controller as
a control origin. A child invoke link points to the existing link and appends the
one original `options.signal`; it never derives provenance from a composed parent
reason. The child-facing delivery controller aborts exactly once with the first
origin's unwrapped `signal.reason`. Later higher-priority events update only the
private `selected` origin and notify descendants; they do not and cannot mutate
`deliverySignal.reason`.

Each link owns one detachable subscription to its parent, at most one listener
to its local invoke signal, and one listener per original root/control signal it
introduces. Listeners use `{ once: true }`, attach before a priority recheck, and
remain live through execution and required child-scope closure. `close()` is
idempotent, removes all listeners/subscriptions, clears descendant reports, and
runs before that invoke promise settles. No global registry is used. Link depth
is the already-admitted invocation ancestry and is bounded by the existing
`maxSubstitutionDepth`; sequential reports are bounded by the existing command
limit and released with their owning frame. This adds no counter, `Shell`, or
`Budget`.

A child that selects a cancellation reports that selected original origin to its
parent link before throwing the exact reason. The bounded private report permits
an outer frame to recognize a descendant cancellation by `Object.is` without
wrapping the rejection. It is cancellation provenance only: it carries no
numeric result/status and is not a public or private observed-status channel.
Unreported errors, and reported reasons that do not match by `Object.is`, remain
unrelated execution failures.

Signal delivery and settlement are separate:

- Inner local deadline, then outer deadline, then root caller abort during cleanup:
  the inner delivered signal permanently retains the inner sentinel; its private
  selection advances inner -> outer -> root, and every still-open boundary plus
  final `Shell.exec` rejects with the exact root caller reason.
- The reverse event order delivers root first and remains root. If outer fires
  before inner, inner delivery/selection is outer and the later inner deadline
  cannot replace it. Pre-aborted multiple ancestors select root, then otherwise
  the outermost aborted invoke origin. Multiple later ancestor events improve
  selection only according to that same immutable rank.
- If the inner frame closes before a later outer/root event, it settles with the
  best reason then observable. The still-open outer boundary reselects after its
  own closure, and the public root rechecks the original caller after the entire
  registered cleanup tree drains. No closed frame's delivered reason is claimed
  to change retroactively.

### Exhaustive outcome and error precedence

Every invoke frame first captures the outcome selected by the existing execution
path, then closes its child scope, then performs private selection, detaches its
link, and only then resolves/rejects. It does not `Promise.race` the invoke against
a timer and does not wait for opaque losing work merely to discover a later result.

At each local invoke boundary the total order is:

1. If the original root caller is aborted, reject with that exact current reason.
2. If execution already produced a rejection that does not match, by `Object.is`,
   an aborted/reported invoke-option origin, preserve that exact rejection. This
   includes budget, host, VFS, middleware, sink, input-close, and other unrelated
   failures, even if an own or ancestor deadline fires during required cleanup.
3. Otherwise, if an invoke-option origin is aborted, select its exact reason by
   outermost-to-innermost rank. This replaces a completed numeric result and can
   improve a captured descendant/local cancellation, but not the unrelated
   rejection in step 2.
4. Otherwise preserve the captured cancellation-matched rejection, if any.
5. Otherwise return the captured validated numeric result.

This explicitly adds local-frame capture/reselection; current `Runtime.invoke`
only uses `try/finally` and does not implement it. Current `InvocationScope.close`
records cleanup failures in the shared root list and does not reject, so the local
selector must neither consume nor duplicate those failures. At the existing root
public barrier, after the full tree drains, the order remains: (1) original caller
abort by exact reason; (2) selected execution rejection; (3) sole cleanup failure
unchanged or the existing ordered `AggregateError`; (4) numeric result. Thus a
cleanup-only failure beats success/124, combined execution plus cleanup preserves
the execution failure, and root caller abort beats both while all cleanup failures
remain observed.

| Captured order | Outcome after required closure |
|---|---|
| unrelated execution rejection; own deadline fires during cleanup | exact execution rejection; never 124 |
| normal numeric result; own deadline fires before child closure finishes | exact own sentinel at invoke boundary |
| child deadline fires during execution or cleanup; no higher event | exact child sentinel |
| inner then outer deadlines; no unrelated rejection | exact outer sentinel at the outer-ranked open boundary |
| inner then outer deadlines; root caller aborts during cleanup | exact root caller reason at all still-open/public boundaries |
| outer then inner deadline | exact outer sentinel; delivered signals already aborted are not rewritten |
| cleanup rejects after numeric result or a mapped 124 | root publishes sole cleanup error or `AggregateError` |
| execution rejects and cleanup also rejects | exact execution rejection, unless root caller aborts |
| own deadline wins the execution interruption; opaque losing work later rejects | exact own sentinel; late rejection is observed, not awaited or substituted |
| child and scope are closed before timer callback admission | prior result/rejection; stopped timer cannot create a timeout |

For `timeout`, status 124 is produced only after `context.invoke` has completed
that closure/selection barrier and rejected with `Object.is(error, ownSentinel)`.
The sentinel is a fresh private object for that one timeout invocation. A root or
outer sentinel, an unrelated error, a primitive/falsy reason (`undefined`,
`null`, `0`, `false`, `""`, `NaN`), an errno-shaped object, and an error selected
only by name/code never map to 124. Nested frames report cancellation provenance,
so an inner unrelated failure is not silently replaced by an outer sentinel and
then mislabeled 124; conversely an exact reported inner cancellation may be
reselected to an already-aborted higher-ranked outer origin.

### Settlement and resource boundary

The barrier joins the selected child invocation path, `invokeScoped`'s owned
`ShellInput.close`, the child `InvocationScope.close`, all registered cleanup,
and explicitly enrolled `createOutputOperation` acquisitions/child operations.
Cooperative awaited sink writes and iterator-return promises on the existing
joined path finish before settlement. Admission is closed before draining, and
cleanup remains exactly once/idempotent through overlapping normal `finally`,
scope close, timeout cleanup, and shell disposal.

This does not expand the barrier to an unawaited legacy sink write, an
unregistered host promise, an opaque pending iterator `next`, or arbitrary
foreign JavaScript. The current input contract explicitly permits a queued
generator return to remain outside the abort barrier when an opaque `next` is
pending (`src/shell/input.ts:61-72`; closest controls in
`tests/shell/input-return-cleanup.test.ts:165-195`). A registered cleanup that
never settles still prevents public settlement; it is a contract violation, not
permission to abandon it.

Concrete cooperative cases include `readBytes`/`writeBytes`, VFS operations that
honor their supplied signal, a blocked owned output acquisition whose registered
release responds to cancellation, and middleware that awaits/returns `next()`.
An ignored signal, a never-settling foreign promise, or CPU-infinite JavaScript
receives only a cancellation request. CPU-infinite work can also prevent the
JavaScript timer callback from running. There is no hard kill, worker termination,
native process group, OS signal, TTY, or bounded-settlement guarantee.

## Budget, state, middleware, and stream invariants

The shell `Budget` at `src/shell/runtime.ts:53-112` contains the mutable counters
`commands`, `iterations`, `bytes`, and `sourceBytes`; `limits`; an internal
`AbortController`; and `signal`, currently composed from the shell caller signal
and the budget controller. It has no deadline counter.

The child must reuse that exact object and its remaining counters. It must also
reuse `fileWrites`, `outputFiles`, filesystem, middleware lineage, command
registry/resolution, cwd/env rules, literal argv, stdin cursor and
`stdinIsDefault` provenance, stdout/stderr sinks, byte backpressure, command
prefix/diagnostics, and depth accounting. Family-local limits remain separate.
A timeout deadline is a command-owned timer and `AbortSignal`, not a new global
deadline/work counter and not a reset of any existing limit.

## Proposed virtual `timeout` profile (separate future authorization)

Synopsis: `timeout DURATION COMMAND [ARG]...`.
Options precede operands; `--` ends option parsing. `--help` and `--version`
before operands return 0 with bounded virtual-command output consistent with the
repository's `sleep` profile (`src/commands/time-env/sleep.ts:99-115`).

Duration syntax is intentionally narrower than GNU: ASCII nonnegative decimal
(`0`, `0.`, `.5`, `12.25`) plus optional `s`, `m`, `h`, or `d`. Signs, exponent
notation, hexadecimal, locale decimal separators, `NaN`, and `Infinity` are
rejected. Parse using decimal digits and integer arithmetic, scale exactly, and
ceil once to milliseconds. Mathematical zero alone disables the deadline. Every
positive representable fraction, including less than 1 ms, becomes at least 1
ms. Values whose ceiled milliseconds exceed `Number.MAX_SAFE_INTEGER` are
rejected with status 125; never pass an oversized delay directly to Node, where
it can become a 1 ms timer.

For a positive duration, the command creates a private per-invocation sentinel,
controller, and chunked monotonic timer. Each scheduled segment is in
`1..2147483647` ms, with elapsed time recomputed from a finite nondecreasing
monotonic clock, following the existing scheduler discipline at
`src/commands/time-env/sleep.ts:56-96`. Register one idempotent stop operation
synchronously before arming the first timer; use the same operation from
`finally`. It clears the live handle and prevents rearming. Direct/custom hosts
without `registerCleanup` still get the `finally` path.

The timer covers the nested invoke promise, including mandatory child-scope
cleanup, but not cleanup owned solely by the outer `timeout` command after the
child invoke has settled. Keep it armed while child cleanup can cooperate with
the deadline. Stop the timer and detach owned listeners before `timeout` returns
or rethrows. Exact duration zero calls invoke without a deadline signal and,
where possible, allocates no controller, timer, deadline sentinel, timer cleanup,
or signal-link listener.

Map status 124 only when the nested invoke rejection is the exact private
deadline sentinel. Rethrow an ancestor caller reason unchanged. Budget,
middleware, VFS, sink, cleanup, and host failures remain errors, not 124. A
normal numeric result, including 126 or 127, passes through. Current runtime
evidence grounds 127 for unresolved command names at
`src/shell/runtime.ts:980-987`; direct VFS script failures such as a directory,
unsupported execution permission, or inaccessible file can produce 126 through
`scriptFile` (`src/shell/runtime.ts:1372-1385`). Do not invent native executable
lookup for registry commands.

Missing duration, missing command, invalid duration, and wrapper option errors
return 125 with a bounded diagnostic. `--signal`/`-s`, `--kill-after`/`-k`,
`--foreground`/`-f`, `--verbose`/`-v`, and `--preserve-status` are unsupported
and must return 125 before nested invocation, not be ignored. `--foreground`
cannot claim TTY/process-group semantics; `--preserve-status` does not authorize
an observed numeric-status channel. No signal-derived 143 or 137 is fabricated.

## Proposed source write-set

Child-signal seam only:

- `src/contracts/command.ts` — `CommandInvokeOptions.signal` at the interface
  currently on lines 4-12.
- `src/contracts/command.md` — normative descendant isolation, reason, and
  settlement text; preserve the current env and cleanup contracts.
- `src/shell/types.ts` — matching `ShellInvokeOptions.signal` at lines 3-11.
- `src/shell/cancellation.ts` — new private, non-barrel-exported origin/link and
  exact-selection helper; it carries no result or numeric status.
- `src/shell/shell.ts` **RESERVED; no edit by this investigator** — seed the
  private root link from the original `ShellExecOptions.signal` and original
  budget-controller signal at the root `Runtime` construction; preserve the
  existing post-drain caller check.
- `src/shell/runtime.ts` **RESERVED; no edit by this investigator** — retain the
  private link in `Runtime`; preserve/append original pipeline control origins;
  add narrow option admission before `parent.child()`; implement local
  capture/close/reselection/detach in `Runtime.invoke`; preserve existing
  streams/state; and audit the alternate shebang forwarding path at lines
  1258-1347 so no internal invoker drops the option or lineage.
- `tests/contracts/invoke.test.ts` — positive/negative structural type rows.
- `tests/shell/invoke-child-signal.test.ts` — new focused runtime rows.
- `tests/shell/env-shebang-host.test.ts` — one alternate source/shebang forwarding
  row if the path can carry an invocation option.

The source-write-set delta from the earlier proposal is the private cancellation
module plus the now-honest reserved `src/shell/shell.ts` root-seeding change.
No change is proposed to `src/shell/cleanup.ts`, `src/contracts/io.ts`, or
`src/contracts/output.ts`: their recursive cleanup and owned-output contracts
remain dependencies to test. Root/package exports remain unnecessary because
the option interfaces are already exported through existing barrels; the private
metadata module must not be exported.

Future timeout command, only after separate source ownership authorization:

- `src/commands/timeout/index.ts`
- `src/commands/timeout/duration.ts`
- `src/commands/timeout/scheduler.ts`
- `src/commands/timeout/README.md`
- `tests/commands/timeout/options.test.ts`
- `tests/commands/timeout/duration.test.ts`
- `tests/commands/timeout/lifecycle.test.ts`
- `tests/commands/timeout/consumer/consumer.acceptance.ts`
- `tests/commands/timeout/consumer/package-negative.acceptance.ts`
- `tests/commands/timeout/consumer/tsconfig.json`

Command family export, aggregate registration, `package.json` export, and moved
strict-consumer inventory remain integration-owner decisions and are deliberately
not included in this leaf write-set.

## Bounded proposed test matrix

Contract/types:

- Omitted/explicit-undefined options and absent/explicit-undefined `signal`;
  readonly valid signal plus the four negative signal types listed above.
- No changes to the existing result type or other option-property types.

Runtime/lifecycle, using manually released gates so no test hangs:

- Null/non-object options, invalid branded value, inherited property, read-once
  getter, getter-thrown identity, and ancestor-pre-abort-over-invalid priority;
  every invalid/pre-aborted row asserts zero command-scope/middleware/resolution/
  VFS/stream/handler admission while acknowledging getter/Proxy effects.
- Two- and three-level manually gated timelines: inner -> outer -> root during
  cleanup; root -> outer -> inner; outer -> inner; pre-aborted root plus multiple
  locals; and an inner frame settled before a later ancestor. Assert immutable
  first-delivered `signal.reason` and exact boundary-selected reason separately.
- Numeric result plus own deadline during cleanup; unrelated rejection plus own
  deadline during cleanup; descendant cancellation plus outer deadline; cleanup
  only; execution plus cleanup; root abort plus both; and opaque late rejection
  after cancellation. Assert `Object.is` identity and no unhandled rejection.
- Detach/listener counts at success, rejection, pre-abort, nested cleanup, and
  repeated close; existing depth/command limits bound links/reports. One alternate
  shebang path proves that private lineage and the option are not dropped.

Timeout profile:

- Existing duration/scheduler coverage remains unchanged. Add only exact option
  admission for `--preserve-status` and other unsupported flags (125, no child
  admission), and lifecycle rows proving that only the fresh own sentinel after
  required closure maps to 124.
- Normal numeric result, unrelated failure, cleanup-only/combined failure, nested
  inner/outer sentinels, and late root abort exercise the total order. No row
  expects an observed status, 143, or 137.

Run focused contract/shell tests first. Build/typecheck and any public consumer
qualification occur only after serialized source authorization; this document is
not evidence of an implemented or passing command.

## GNU 9.7 primary-source boundary

The ignored local oracle is GNU coreutils 9.7 for Darwin arm64. Its binary,
source, and Texinfo identities are in `identity.json`. Fresh upstream `v9.7`
raw source/Texinfo hashes matched the local files.

Pinned source says zero disables and timers round upward/saturate
(`timeout.c:100-160`), defines options and statuses (`timeout.c:250-318`), parses
nonnegative duration plus one optional unit (`timeout.c:356-376`), creates native
process groups/forks/execs (`timeout.c:469-582`), and selects 124 after native
wait when timed out without preserve-status (`timeout.c:588-630`). The pinned
manual documents native TTY/process-group/signal behavior and statuses at
`coreutils.texi:18821-18941`.

Those OS facilities are comparator semantics, not virtual-bash capabilities.
The mutable online manual currently labels a later release and is not the 9.7
pin. No broad benchmark or product execution was performed.

## Serialization blockers

`src/shell/runtime.ts` and `src/shell/shell.ts` are reserved under the current
Poincare/getopts Stage 2 candidate and Locke review. Even though their inspected
bytes match `618d8967`, the child-signal seam must wait for root approval and
explicit ownership serialization. `src/commands/timeout/**` remains unauthorized
until that seam lands; the `--preserve-status` profile is already fixed at 125.
There is no approved source, export, package, aggregate, test-fixture, staging,
or product commit action in this proposal.
