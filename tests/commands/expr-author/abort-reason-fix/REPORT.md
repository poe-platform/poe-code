# Minimal cancellation completion fix

## Candidate and scope

Source/regression commit: `27a7793526830768484885afba5832bf8bb248b5`.
Only `src/commands/regex-execution/client.ts` and the new
`tests/commands/expr/abort-reason-regression.test.ts` belong to that commit.
This directory is separate author evidence, not independent acceptance.
Original source `fe7083d99b8ccfdfbbb9b7209e0a6abbe7979724`, original author
evidence `68e0d848`, and the independent review execution subtree remain untouched.
Root must assign a DIFFERENT reviewer to replay frozen acceptance against this
new candidate; these results do not rescore the old source.

The prepatch run used the live checkout, not a committed archive. Its recorded
HEAD was `1ebc9d71607b8b9f73bd65bd75ca91fed430ae89`; the regex-execution and expr
source directories had no differences from `fe7083d9`. Between that checkpoint
and the source commit, the only changed tracked product source was `client.ts`.
Concurrent unrelated evidence commits/staging are not part of this fix. The
regression fixture bytes are identical before and after the source change.

## Declared versus native signal contract

`RegexExecutor.request` declares an `AbortSignal` parameter. The installed Node
TypeScript interface extends `EventTarget` and declares `aborted`, `reason`,
`onabort`, and `throwIfAborted`. The new `StructuralAbortSignal` explicitly
implements that interface, inherits actual EventTarget methods, implements
onabort delivery and idempotent cancellation, and is assigned to an AbortSignal
variable. Strict compilation uses the repository's strict NodeNext flags, not
an incomplete duck type, unsafe assertion, or interface replacement. The
fixture exercises function/object listeners, listener removal, dispatchEvent,
onabort's receiver, and throwIfAborted. Only literal-preserving `as const`
assertions occur in the fixture.

This is a synthetic structural TypeScript profile, NOT a native/WebIDL-conformant
signal with an undefined abort reason. The DOM specification says a native
AbortController given undefined stores an AbortError DOMException; it also
defines an aborted signal in terms of a non-undefined internal abort reason.
Node documents reason as arbitrary data and throwIfAborted as throwing reason.
The native-undefined test asserts the actual DOMException/AbortError and compares
identity against signal.reason, never against the undefined argument. Thus the
bug is established for the current declared direct executor interface, not
claimed as a native AbortController(undefined) defect.

Primary sources consulted via web.run on 2026-08-27:

- `https://dom.spec.whatwg.org/#interface-abortcontroller`
- `https://dom.spec.whatwg.org/#interface-abortsignal`
- `https://nodejs.org/api/globals.html#abortsignalreason`
- `https://nodejs.org/api/globals.html#abortsignalthrowifaborted`

The synthetic signal is exercised through direct request for both descriptor
families. Actual session.run and session.matchExpr cancellation use native
signals because sessions compose signals with native AbortSignal.any; no native
combinator is replaced to make the structural fixture work. A separately
injected, fully typed Worker subclass throwing undefined from postMessage
reproduces explicit-undefined transport rejection through both session methods.
That transport control is synthetic, not evidence that native postMessage
ordinarily throws undefined. Successful replies come from the real built worker.

## Cause and smallest fix

Slot.exchange previously treated an undefined error argument as success.
RegexExecutor.run separately treated an undefined failure variable as success.
An active or startup structural cancellation therefore fulfilled undefined;
explicit undefined postMessage failure instead became a protocol error.
Both completion points now carry an explicit rejection boolean independently
of the exact value. The original value is never normalized or replaced.

No defaults, queue arithmetic, worker admission, deadlines, reply validators,
retirement order, session closure, cleanup registration, public API, package
exports, dependencies, or host-promise waiting were changed. In particular the
existing retirement await still precedes request settlement. No other source
path was edited; the remaining Slot terminal storage was not broadened into a
separate lifecycle refactor.

## Reproduction and checks

Environment: Node v22.22.2; TypeScript 5.9.3; Darwin host. Commands and outcomes
are in `commands.json`; raw logs are preserved individually without rewriting
earlier captures. `before-manifest.txt` records the first source checkpoint;
`after-manifest.txt` binds the candidate, built entries and selected oracle.

| Check | Before | After |
| --- | --- | --- |
| Build | exit 0 | exit 0 |
| Strict new fixture plus imported source | exit 0 | exit 0 |
| New regression suite | 103/111 pass, 8 fail | 111/111 pass |
| Existing focused executor/expr/cleanup plus new suite | not run | 377/377 pass |

The eight original failures are startup and active structural-undefined
cancellation for each descriptor family (four), retirement-latched structural
cancellation for each (two), and explicit transport-undefined rejection identity
through both session methods (two). Native undefined/0/null/false/empty-string/
Error controls all passed before the fix; structural preaborted/queued controls
also passed. Both before and after reports retain their original denominators.
There were zero skipped, cancelled or TODO tests in these runs.

The new suite covers direct legacy/expr requests, native session.run/matchExpr,
startup/active/queued/preaborted signals, exact reason identity, queue sibling
survival and subsequent success, natural structural success, fully valid
CommandContext positive controls, synchronous cleanup registration, overlapping
idempotent cleanup, and settlement blocked until an owned retirement latch is
released. Existing suites cover grep/rg/glob successes, defaults, queue count/
byte bounds, startup/active timeouts, registration rejection, sibling independence,
message failures, invocation cleanup and shell lifecycle.

All test processes exited. The new suite reports 138 observed workers after the
fix, zero active before the safety cleanup and zero after; all test-owned worker
listeners are checked removed. Existing lifecycle/executor hooks also report zero
active before safety cleanup. No test process, held retirement gate or owned
worker is intentionally left running.

## Limits and other reviewer findings

This is bounded author verification, not a full repository gate, strict-all
consumer inventory qualification, independent replay, deployed-service proof,
performance result, superiority claim, or evidence of 72 hours of work. The
focused suite includes the authenticated GNU coreutils 9.7 expr oracle on Darwin,
not GNU/Linux; unsupported dialect controls remain unsupported, not parity passes.
No immutable whole-tree pre/post archive or append-proof tree check was run.
Canonical tests do not write this directory; future captures must use new paths.

The original worker-cap-maxPatternBytes/maxSubjectBytes rows are NOT fixed or
rescored here. Read-only inspection of the preserved
`extension-review/execution/supplement-fe7083d9-first/extra-driver.mjs.data`
shows `settle(session.matchExpr(...))`: synchronous input-byte validation can
throw before settle receives its argument. `validateExprInput` explicitly throws
ExprMatchError(category limit) at these byte bounds before worker dispatch, and
the preserved original results report `regex input bytes limit exceeded` as an
outer rejection. That is evidence of a harness boundary mismatch, not evidence
of missing byte limits. The live reviewer driver has since gained a deferred
invocation wrapper; this leaf did not change it or rerun/reclassify its cohort.
Any broader regex, worker-limit, or independent reviewer issues remain with root
and their assigned owners, outside this undefined-completion fix.
