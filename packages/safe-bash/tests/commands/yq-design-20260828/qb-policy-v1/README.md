# yq QB-F1/F2 additive policy — PRECODE / UNIMPLEMENTED

Date: 2026-08-28. This packet closes the author-design questions QB-F1 and
QB-F2 for a different freeze. It changes no source, test, public API, shared
`Budget`, limit, diagnostic, or earlier artifact. **yq implementation remains
unauthorized and root FINAL GO remains held.**

## Authority and qualification

The effective order is the b311 initial profile, final contract
`5783b8e03912f7774d2a86ba1dae9de778121273`, final adoption
`cfa6fbcb72c5a3e228c4ffbea7cb1719827b2707`, the reconciliation at
`544f8279138cb1335ded08f9db638410e91c1324`, root's stated N decisions, and
this narrow QB delta. Earlier rules remain effective unless expressly changed
here.

The accepted source base is exactly
`5137a74ec855a32d8a8860eb66b62eb44d11e290`. The accepted length delta is
`74361026502d76b8c2b696f9c60e410ac9b78d95`, accepted through Plato
`16c4502da78ac209e8979d7bd576f2be5492f104` with the relayed 60 holdouts and
93 selected regressions. The original 845-file projection, SHA-256
`351e03ad72b0bd82bb16d97cc50ec80b136edeaf705ec1590b414cb4cdf8b82e`,
omitted its README;
the complete-846 README-only addendum
`6d5cf6c640d87a5e427049d329eabf5c39136259` has package SHA-256
`ff230f2e9079cc843198533e412f836abb62e4ade63f4fa210b7269f7deb4eff`,
adds only the exact baseline README, and leaves the common 845 bytes and modes
unchanged. Those are accepted root-relayed facts; this packet did not rescore
845, unpack a pack, or replay any test.

Reconciliation has 194 original records. Its normative 80 and query-budget 62
inventories overlap and are not additive unique-case counts. This packet adds
no case record and executes no product, native, reference, package, or existing
checker. `identity.json` binds the immutable inputs and the narrow live-byte
comparison; the live interpreter difference is not part of this source base.

## QB-F1: genuinely asynchronous owned boundary work

The final contract's proposed synchronous yq-owned `measure(): number` and
`stringifyJson(): string` roles are superseded only for the private yq consumer:

```ts
interface YqOwnedWork {
  charge(units?: number): Promise<void>;
  measure(value: Json): Promise<number>;
  stringifyJson(value: Json, options: {
    readonly pretty: boolean;
    readonly maxBytes: number;
    readonly limitName: "maxValueBytes" | "maxOutputBytes";
  }): Promise<string>;
  reserve(ordinaryUnits: number): YqPrepaidWork;
}

interface YqPrepaidWork {
  beforeUnit(): Promise<void>;
  finish(): void;
  abandon(): void;
}
```

These remain private roles in the new adapter/yq modules. `Json`, `Decimal`,
`objectKeys`, numeric text, ordered-object behavior, errors, limits, existing
`Budget`, parser, and interpreter remain the accepted structured implementation;
no evaluator is copied. The old `Budget.value` and synchronous `stringify` may
still execute at their existing engine call sites. They are not called by yq to
claim cooperative boundary validation, measuring, or encoding.

`charge(n)` processes positive safe-integer ordinary units without crossing the
local checkpoint remainder. Before the next unit when the local pending count is
1,023, it awaits the existing `Budget.tick()` and resets that local count; each
ordinary unit is charged through existing `Budget.step`. It checks the borrowed
signal around the await. There is no async wrapper around a whole synchronous
graph walk.

Owned measurement is one asynchronous iterative graph traversal combined with
the already-required recursive validation. It checks depth before descent,
collection size before member traversal, finite/safe numeric validity, and
compact-byte projection. A validated/encoded node is its already-adopted node
unit. Mapping keys, string content, and canonical number text are visited in
bounded Unicode-safe fragments; every started 1,024 UTF-8 bytes of each distinct
nonempty retained/encoded fragment is charged. Thus a huge scalar cannot hide
behind one graph-node unit. A bounded `objectKeys` snapshot and bounded
`JSON.stringify` of one fragment are synchronous primitives, not falsely called
checkpoints; the graph and scalar traversal around them is asynchronous.

JSON and YAML encoding use the same private Unicode fragment cursor and existing
`numberText`/`Decimal.text` semantics. JSON string escaping is computed from
bounded code-point-aligned fragments. The YAML encoder uses those cursor byte
facts rather than a second value evaluator. It checks every fragment, escape,
indentation repeat, join, separator, and LF before retaining or allocating it.
Raw-string output uses the same cursor. The full output document is still
encoded/preflighted and globally admitted once before the first sink submit,
with the unchanged 16,773,120-byte stdout cap and 4,096-byte diagnostic reserve.
NUL is emitted as the six literal ASCII bytes `\u0000`, never as a raw NUL.

The compiler remains the fixed synchronous compiler with only its actual
existing charges and prior bounded-sync qualification. Interpreter-internal
`step`, `tick`, `value`, collection, and Decimal charges remain unchanged. This
delta adds no query-instruction, scheduler, Promise race, child deadline, global
counter, public limit, or broad jq refactor.

## Owned checkpoint state

`pending` is a yq-owned integer in `[0, W]`, where `W = 1023`. It counts ordinary
yq-owned units since the last yq-owned checkpoint. It is not derived from, and
does not expose, `Budget.steps` or `Budget.nextYield`; both remain private. Only
a successful normal `Budget.tick()` or prepaid checkpoint resets `pending`.
Unrelated awaited host work is not used to weaken this conservative schedule.

The boundary is **before the next ordinary unit**: 1,023 units may finish with
`pending = 1023`; another unit first checkpoints. For current `c` and planned
ordinary units `U`:

```text
K(c, 0) = 0;                         c'(c, 0) = c
K(c, U) = floor((c + U - 1) / W);   c'(c, U) = c + U - K(c,U)W, U > 0
total(c,U) = U + K(c,U)
```

All operands and intermediate sums are checked nonnegative safe integers before
arithmetic. `K` is the exact number of future checkpoints; each checkpoint is a
real Budget charge because ordinary execution would call `Budget.tick()`, whose
line 59 calls `step()` once.

## QB-F2: estimate, reserve once, then copy on prepaid credit

Alias target selection retains the root-adopted latest-record rule: a new pending
definition shadows an older completed definition, with no fallback; earlier
completed alias copies retain their old values. The selected completed anchor
subtree is composer-owned, mutation-forbidden, and not exposed to a query, sink,
or callback between estimation and copy.

The following order is normative:

1. Resolve the active completed anchor and validate the existing input/anchor
   cache. Reject pending, missing, forward/current/cyclic, or invalid records.
2. Run a separate asynchronous bounded estimation/validation walk. Its node and
   bounded key/string/canonical-number fragments are ordinary owned work and use
   `charge`, so its costs and checkpoints are charged immediately. It builds
   only bounded metadata: an iterative stack bounded by depth and scalar numeric
   descriptors/counters bounded by collection/node caps. It retains no duplicate
   payload graph. This is metadata allocation, not a zero-allocation claim.
   This is an explicit application of the adopted recursively-validated-node and
   started-1,024-byte retained-fragment rules, not a new unit category or cap.
3. Produce an immutable descriptor containing exact copied nodes, maximum added
   depth, per-collection sizes, compact-value bytes, scalar/key/number-text byte
   lengths, and `U`. For copy work, `U` is one unit for every copied node plus
   `ceil(bytes/1024)` for each distinct nonempty key, string-scalar, or canonical
   number-text payload-copy operation. A partial-byte counter continues across
   execution fragments of that one operation, but resets between operations;
   buckets never merge across distinct operations.
4. Using checked subtraction/addition, validate depth, every collection and
   scalar, projected current-document node and compact-value totals, and the
   cumulative alias-event limit. This reserves logical copied payload/nodes; it
   does not prove engine heap/RSS, allocator, GC, or global memory leases.
5. Read the local `pending` left by estimation, compute `K`, `c'`, and total
   above, and check all as safe integers. Call existing `Budget.step(total)`
   **once and last among failing admission checks, before any copy allocation**.
6. If that call succeeds, synchronously commit the alias/node/value projections,
   install one local prepaid reservation, and then allocate. These admitted
   counters, all prepaid work, and unused credit are never refunded. If `step`
   throws, no reservation or local projections are installed and no copy is
   allocated; accepted source lines 53-56 mean Budget's private steps have
   already increased before `maxSteps` throws.

The estimator's work changes `pending`; planning from its earlier value is an
internal error. The descriptor is immutable and the source graph cannot change,
so execution must consume exactly its described schedule.

`beforeUnit()` is awaited immediately before each ordinary copy operation. At a
boundary it first consumes one prepaid checkpoint credit and invokes a private
`prepaidCheckpoint`: check the borrowed signal, await
`setImmediate(undefined, { signal })`, check the signal again, and reset local
`pending`. It then consumes one ordinary credit before the copy operation. It
does **not** call `Budget.step` or `Budget.tick`; all such costs were consumed
once by reservation. This new private helper deliberately does not update or
promise identical timing for Budget's private yield state. A later ordinary
Budget tick may observe the reservation-advanced private step counter.

`finish()` requires zero ordinary and checkpoint credit and exact `c'`.
Attempted overrun fails before the extra operation; underrun fails before the
copy can be published. Either is an internal contract/control error, not a new
normal yq diagnostic without root catalogue approval. `abandon()` expires all
credit without refund and publishes nothing. No nested reservation, per-alias
Budget, per-document Budget, shadow-only ticking, or post-reservation real tick
is permitted.

One serialized session owns the Budget and local state. While a reservation is
active, another query run, scanner advance, estimator, normal owned charge, or
reservation is rejected as internal misuse. This prevents interleaved consumers
from spending reserved credit or changing checkpoint state.

## Abort, publication, and closeout

- Before reservation, caller abort is preserved by exact reason; estimator
  partial metadata is discarded. Existing admission/limit failures allocate no
  alias copy.
- After successful reservation and during a prepaid checkpoint/copy, abort keeps
  all charges, discards the entire partial copy, publishes no alias value, and
  permits no session reuse. `setImmediate` rejects with the borrowed signal.
- A completed copy becomes visible only after exact credit closeout. A later
  query/encoding failure cannot undo already completed output effects.
- The invocation close is registered synchronously before owned resource
  acquisition/admission, closes admission first, is shared/idempotent, and the
  same close runs in `finally`. Active generators, output operations, iterators,
  and admitted cooperative work drain before direct execution/public settlement.
  Opaque host work gains no invented preemption.
- Direct-handler and outer-Shell outcome selection remains exactly the accepted
  final contract: root caller cancellation first, then escaping execution/control
  failure, then cleanup, otherwise mapped catalogue result. No new query
  provenance or normal status is asserted here.

## Root N alignment for Sagan's different freeze

- N1 / G03 (with WRK-25 retained): key restrictions are production-specific.
  Do not impose a blanket braced-flow or quoted-key ban.
- N2 / NUM-15 / N07: for a nonzero coefficient, remove trailing coefficient
  zeros and increment the normalized exponent **before** normalized-range
  admission. Raw exponent syntax/accumulation refusals and the zero-coefficient
  out-of-range refusal remain; there is no zero exception.
- N3 / UTF-12 / Q11: in a double-quoted scalar, adjacent high-then-low
  `\uXXXX\uXXXX` escapes combine before Unicode-scalar validity. Lone, reversed,
  or intervened pairs fail.
- N4 / T13: explicit-tag lexical-family validation is direct. `!!float 7` is
  accepted even though implicit Core resolution would choose integer;
  `!!int 7.0` is refused.
- ENC-07: root encoder spelling for NUL is literal `\u0000`.

The adopted 54-entry output catalogue remains the finite binding.
`ALIAS_DUPLICATE_ANCHOR` stays reserved/unreachable under root's anchor-reuse
choice; it is not activated or repurposed as a new feature.

These are alignment inputs, not parser implementation or execution evidence.
The actual Decimal range binding still requires the assigned independent review;
this packet does not infer that every N hold is measured or finally frozen.

## Handoff

`controls.json` was sealed as literal synthetic expectations before executing
`check-accounting.mjs`. The runner imports no product module and allocates no
large resource; it checks only constant-time integer accounting, rejection
classification, and the exact boundary formula. Passing it is not Budget,
alias, parser, query, cancellation, product, native, or reference proof.

The precise future QB mechanism write set is new files only:
`src/commands/structured/query-core.ts` (private session, owned state, async JSON
measure/encode, reservation helper), `src/commands/yq/accounting.ts` (ledger,
alias estimator/descriptor/copy consumer), and `src/commands/yq/encoder.ts`
(async YAML encoding). Root/export/package integration remains its assigned
owner's separate work. No shared-Budget edit or additional author question is
required by this mechanism. A different Sagan freeze must authenticate and bind
the final design before any implementation authorization.

## Post-seal narrow clarification — 2026-08-28

This section supplements, but does not rewrite, the statement sealed at
`89e403e080ba2ac051bcc19a634d9e964620152d`. At fixed baseline
`5137a74ec855a32d8a8860eb66b62eb44d11e290`, `Budget.tick()` calls `step()`
and, at its yield boundary, advances `nextYield`, directly awaits
`setImmediate(undefined, { signal: this.signal })`, then calls
`this.signal.throwIfAborted()`. It has no catch around that await, so its
post-await check does not execute when the timer promise rejects. This source
observation identifies only the future private `prepaidCheckpoint` gap; it does
not change or newly qualify normal `Budget.tick()` and requires no shared edit.

The future prepaid helper must use the existing Budget-style signal check
(`signal.throwIfAborted()`, as used by `step()` and `tick()`) before awaiting the
signal-bound immediate. Its catch must select outcomes explicitly: when the
borrowed signal is then aborted, call that check and let the exact
`signal.reason` escape, including a falsy, `null`, or `undefined` reason, rather
than propagating a timer `AbortError` wrapper; while that signal remains live,
rethrow the original yield failure unchanged. After a fulfilled await, perform
the same signal check before resetting `pending`. Do not reset `pending` on a
failed checkpoint. The consuming copy path's `finally` expires the reservation
through the same idempotent `abandon`/owned-close path and publishes nothing.
Because the helper directly awaits the signal-bound immediate, that scheduled
immediate naturally settles or is cancelled before the helper settles; this
adds no `Promise.race`, scheduler injection, listener/resource lifetime, or
work outside the owned close.

Illustrative prospective cases, not executed here: abort reasons `false`,
`null`, and `undefined` each escape exactly; for an object reason `r`, even when
the timer rejection is the same object, selection follows the borrowed
signal's aborted state and preserves `r` by identity, not an equality-derived
provenance rule; if the borrowed signal is not aborted and the immediate rejects
with `e`, `e` escapes unchanged even if it resembles cancellation. The existing
outer outcome rules remain separate: a root-caller abort observed before public
settlement retains first priority, while an unrelated yield/execution failure
is not converted to cancellation while the borrowed parent signal is live, and
the outer Shell retains its accepted mapping.

Evidence chronology is likewise narrow. The final literal cohort contains 23
rows and passed according to the author report. The earlier 20-row table run was
preliminary and is not product proof. The execution fields in `identity.json`
describe the final 23-row cohort, not the total number of historical runner
invocations; that exact total was not durably retained, and no log or raw count
is reconstructed here. This clarification ran no accounting runner, product,
source implementation, native/reference program, package, or existing test.
