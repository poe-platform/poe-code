# Execution identity

`CommandContext.executionScope?: object` is an optional, opaque borrowed identity
for one execution. Each `Shell.exec` owns a fresh frozen empty object on its
runtime `Budget`. Commands dispatched within that execution receive the same
identity, including pipelines, substitutions, interpreters and nested `invoke`
calls. Concurrent executions do not share it, even on the same `Shell`.

The identity exposes no budget values, cancellation controller or mutation
authority. Commands must not attach state to it. A command factory may associate
private execution-local state with it through a `WeakMap`; the host's configured
limits remain authoritative. Forward the identity through transparent custom
context adapters rather than manufacturing a new one for each command.

Direct/custom hosts may omit the field. Curl then uses an independent scope for
each invocation, including all its URLs. Such hosts can explicitly share an
object across invocations when they represent one execution. The field does not
change `CommandInvokeOptions` or create a separate runtime budget. See
`network-deadline.md` for curl's aggregate deadline and cleanup contract.

# Literal invocation environment

`CommandInvokeOptions.replaceEnv?: boolean` is additive. Absent or false retains
the runtime's existing environment merge behavior and PWD treatment. True uses
a fresh copy of exactly `options.env ?? {}` as the exported environment at
command entry: no merge with inherited exports, implicit PWD or promotion of
unexported/local variables. Supplied PWD is an environment value, not a cwd setter.
Environment key/value validation remains required before child execution.

This replaces the child environment, not generic shell state. Parent values,
export attributes and function locals must remain unchanged on success, error
or cancellation. Cwd resolution remains independent. A child Bash interpreter's
own initialization is separate from the environment passed to it.

Literal argv, middleware, shared execution/output/depth budgets,
stdout/stderr transfer and stdin cursor/origin rules are unchanged. Do not
implement replacement with a new Shell, new budget or a callback-only bypass.

Core `env COMMAND` explicitly requests replacement for its already-computed
environment, including plain assignments and `-u`, not just `-i`. With no invoke
hook, its existing registry/callback fallback still receives that exact map.
Generic directExecutor/xargs/find callers retain their existing default behavior.

# Child cancellation

`CommandInvokeOptions.signal` is an optional child-cancellation authority. It
must be a native `AbortSignal`; omitted and explicitly `undefined` signals retain
the borrowed path. Admission reads the signal option once after checking an
already-aborted ancestor and before child scope, middleware, stream, filesystem,
handler or owned-output acquisition. A valid pre-aborted signal rejects with its
exact stored reason.

Live cancellation flows only into the selected child and its descendants. It
does not cancel or close the parent, a sibling, another pipeline stage or another
shell. First delivery is immutable. Settlement ranks the root caller above an
actual escaping execution/control failure and ranked invoke cancellation. Equal
rejection values do not establish provenance: an unchanged runtime-owned promise
route or authenticated descendant report is required. Handler errors already
mapped to a diagnostic and numeric status remain mapped and discard that report.

Registered child cleanup and cooperative owned work drain before the child link
detaches and the invoke promise settles. Cancellation cannot undo completed
effects or terminate opaque host work.

Curie owns the contract/core consumer; Sagan owns runtime/types. The additive
field and boundary-forwarding tests do not establish runtime support. Acceptance
requires the actual-shell nested env row and export/local/parent/cancellation
regressions after both implementations are committed. Preserve the historical
leak reproduction and original six-row cohort.

# Cooperative invocation cleanup

```ts
export type InvocationCleanup = () => void | Promise<void>;

interface CommandContext {
  readonly registerCleanup?: (cleanup: InvocationCleanup) => void;
}
```

This additive hook registers **cooperative, invocation-owned resource cleanup**.
It does not expose drain/close authority, change CommandInvokeOptions, add plugin
configuration or establish a global output/first-read lifecycle. Direct/custom
hosts may omit it; command finally cleanup remains necessary, but omission does
not promise a public cancellation-settlement barrier. Existing structural contexts
remain valid. The existing contract/root star exports expose the new type without
barrel changes; packed consumer verification belongs to integration acceptance.

## Admission and ownership

- Register synchronously **before acquisition**, including admission of work that
  can create a worker/lease later. A callback may close an initially empty owner.
  Registration itself does not acquire or invoke cleanup and returns no handle.
- Each dispatch has an invocation scope. Nested invoke, pipelines and substitutions
  remain tracked by the enclosing exec even when an outer abort race stops awaiting
  a handler. Closing begins on dispatch settlement, interruption or owning-shell
  disposal. Close admissions before starting drains, including descendant scopes.
- Registration on a closing/closed scope throws synchronously. New nested invoke
  through such a context rejects before child dispatch, middleware, filesystem work
  or resource creation. A caller-aborted scope preserves the exact caller reason;
  otherwise an Error indicates closed admission (message is not contractual).
  A non-callable cleanup is a synchronous TypeError, not an accepted registration.
- Registration is not permission for a late continuation to acquire resources.
  The resource owner must permanently close its own acquisition admission during
  cleanup and cover already admitted cooperative acquisitions. An asynchronous
  continuation cannot reopen it after drain completion. Arbitrary host promises
  and input reads are not acquisitions the runtime must wait for.

The runtime's drain is idempotent: it invokes each accepted registration at most
once and repeated drain/dispose calls await the same outstanding cleanup work.
The callback must also be idempotent across a command's normal finally path and
runtime drain, including overlapping calls: release once and share the completion
promise. Registering the same callback twice creates two registrations, not two
resource ownership rights. Callbacks must not depend on cleanup registration order
or use a closing context to start new nested work.

Ownership is local, not a global worker-count assertion. Release the invocation's
requests/leases and await retirement owed by that ownership. Concurrent invocations
or another Shell can still legitimately own shared workers; cleanup must neither
terminate their leases nor await global worker zero. Plugin disposal remains a
separate lifecycle, not a substitute for delaying an already returned exec.

## Settlement and failures

Before public exec resolves **or rejects**, the runtime must close its admissions
and drain every accepted cleanup in its invocation tree, including nested scopes
whose handler promise lost an abort race. Shell.dispose must likewise await its
outstanding registered drains before settling. A concurrent/repeated dispose must
not return early merely because another dispose marked the shell closed.

Start all eligible cleanups even if one throws, rejects or is still pending; await
their completion and observe every failure. Do not race the drain against the
already-aborted signal or impose an arbitrary short timeout that abandons owned
workers. Await only explicitly registered cooperative cleanup and its tracked
resource work, not opaque handler/middleware/FS/sink/input promises. Observe late
handler rejections without waiting for uncooperative host execution to finish.
An uncooperative nonsettling registered hook violates this contract; the hook is
not universal hard preemption of arbitrary trusted host JavaScript.

Choose the public outcome after draining, with this precedence:

1. A caller abort observed before public settlement wins **by exact reason identity**,
   even if the reason is a primitive or resembles an errno/execution failure.
2. Otherwise preserve the original execution rejection selected by the existing
   execution path, again without wrapping or mutating it to attach cleanup errors.
   Do not wait for an opaque losing handler to discover hypothetical later errors.
3. Otherwise reject with the sole cleanup failure unchanged, or AggregateError
   containing all cleanup failures when multiple registrations fail. A completed
   CommandResult, including a nonzero exit code, does not hide a cleanup rejection.
4. With no such failure, return the existing selected command/pipeline result.

Internal downstream-close cancellation is **not caller abort**. Track its origin,
not merely an AbortError name, errno, truthiness or the fact that a combined signal
is aborted. Preserve existing early-pipe/pipefail status selection, but drain owned
resources before returning even a successful `grep ... | head -n 1`. Secondary
cleanup failures must all be handled/retained by the drain when a primary reason
wins; do not replace the primary, emit unhandled rejections, or report cleanup-only
failure as success. This adds no public diagnostics/configuration API.

## Acceptance boundary

The contract/type addition alone does not fix the outer runtime/public exec races.
The retained regex review at `ef8bbe7`/`839f2d4` reports five premature-settlement
observations per compiled/packed run; those remain unresolved by this type commit.
Runtime scope/drain implementation and pre-acquisition regex registration need
separate source ownership and actual public-boundary independent verification.
Required follow-up controls include sync/async/throwing cleanups, drain-all,
repeated/overlapping finally and dispose, caller reason identity, early pipe close,
nested admission after closing, and concurrent sibling/other-Shell lease isolation.
Five custom pre-first-read requirements are separate; this hook introduces no
beginOutput, probe reads, implicit pipe activation or budget reset.
# Owned byte arguments

`CommandContext.args` remains a readonly string vector. `CommandInvoker` keeps its
existing command/string-argv/options signature. Optional `argumentValues` on both
the context and invocation options carries lossless values; its `args` must be
the exact same array object as the associated argv, not merely equal strings.

`createCommandArguments(values, allocation?)` accepts `readonly ShellValue[]` from
`contracts/value`. It snapshots and freezes its own value and text vectors.
`getCommandArguments(context)` authenticates supplied carriers and rejects stale
argv identity. With no carrier it snapshots the legacy string arguments. There
is no mapping from decoded strings back to bytes: FF, FE and literal UTF-8 U+FFFD
can have equal text projections without sharing byte identity.

The carrier exposes `args`, trusted immutable `values`, `bytes(index)`,
`slice(start?, end?)`, `select(indices)`, `concat(...others)`,
`withValues(values)` and `join(separator?)`. Byte access returns a new owned copy;
out-of-range access returns undefined. Selection rejects invalid indices.
Slices and selections share immutable values, never mutable byte storage.
`withValues` accepts shared values or Uint8Array inputs, copying raw inputs via
the shared value primitive. It is an explicit reconstruction, not an inference
from matching text. Replacing argv in a copied context must also replace the
carrier and use its exact `args` vector.

An optional ValueAllocation is checked before observing caller array type or
length, then reserves the carrier/vector structure before snapshot/projection.
The snapshot captures the vector after metadata admission; same-extent
replacement during that reservation is permitted. Array extent changes during
admission reject before publication. The admitted operand snapshot is complete before
any nested byte-copy reservations; later callbacks cannot replace selected
operands by mutating the caller's vector. This is not an atomic snapshot of
arbitrary host getters or concurrently mutated byte storage. The exact new
carrier is committed. Failed construction releases its newly allocated raw
operands in reverse acquisition order and then its metadata reservation; it
does not release borrowed shared values or retry a primitive's completed release.
Primary and cleanup failures retain their identities, including falsey reasons.
Join admits temporary parts storage before filling it and releases scratch on
success or failure. A failed join also rolls back any newly created output.
Byte copies, reconstruction and joining retain the allocation authority.
The runtime owns underlying shared-value retention and successful reservation
lifetimes. Moving arguments to a child owner uses
`createCommandArguments(selected.values, childAllocation)`, without decoding or
copying their immutable byte payloads. Existing-owner derivation is not an
implicit lifetime transfer. Closed owners may reject subsequent allocations.

Middleware which forwards the same context preserves the carrier. Plugins may
use bytes/values and the generic reconstruction helpers, including when invoking
another command. A plugin which reads or rebuilds only string argv intentionally
uses the compatibility text view; it is not thereby a lossless byte consumer.
String-only plugins and other legacy text interfaces are not universally
qualified for binary data by this additive API.

The basic command byte path preserves printf format literals, %s and %b data,
optional -- indexing, repeated formats, missing fields, byte precision and byte
padding. Echo joins raw operands and retains its distinct octal-escape grammar.
Other textual printf conversions keep their existing text semantics; this is
not an assertion of complete printf/native parity. Direct execution, env command
operands (including split-string token generation), xargs fixed/replaced argv,
find -exec and timeout transport explicit carriers rather than recover values
by text equality. Existing string environment/path interfaces and xargs' strict
UTF-8 stdin parser remain separate boundaries, not newly certified binary APIs.
