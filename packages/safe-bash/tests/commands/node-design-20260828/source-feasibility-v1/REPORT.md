# Frozen SafeJS call feasibility — source followup v1

2026-08-28; **SOURCE INSPECTION / PREPARE ONLY**. Append-only followup to
fb16cb61b1c1220da0ba464b0eeaf75cf20d0ed2; its four artifacts remain unchanged.
Only public source at bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e was inspected.
SOURCES.json binds physical, one-based source lines, hashes and prior inventory
matches. No engine, native oracle, build, install, probe or private access occurred.

## Corrected verdict

**Transparent guest-synchronous suspension is representable through an existing
internal branded-closure seam in the unchanged engine.** Ordinary public host-function
injection does not select that seam. This corrects the initial design's overbroad
suggestion that an interpreter suspension facility necessarily needs to be added.
The missing supported integration boundary is a legitimately supplied, same-instance
intrinsic factory and its ownership/accounting contract—not necessarily new evaluator
machinery. This is a source-bounded candidate path, not an executed qualification,
documented public extension guarantee, or universal impossibility theorem.

ROOT's settled direction stands: optional injected qualifying provider; zero
core/command dependencies; no native/process/eval fallback; genuine sync semantics;
explicit virtual read/write grants with writes denied by default. No bundled/default
or full-Node claim. This call-path finding neither establishes nor rules out CLI forms
based on unrelated grammar limitations. NP1 and its exact caps still await review.

## The decisive branches

**Public ordinary functions.** `RunOptions.bindings/modules` accept
`CallerInjectedBinding` (S07/S03). `wrapCallerInjectedFunction` wraps both a normal
function returning a Promise and an `async` function. `executeHostCall` branches on
the *returned value*: synchronous values are copied and returned; Promise-like values
become `SandboxPromise` through `createHostCallPromise` (S03:361–447). Without a
journal, `copyHostResultToSandbox` reaches the equivalent Promise-boxing branch
(S03:151,459,769). Dropping the host function's `async` keyword is not a fix.
A pure synchronous callback returning `7` already works; missing builtin fs is
irrelevant to that fact.

**Internal intrinsic.** `SandboxClosure.call(args, context?)` returns
`SandboxValue | Promise<SandboxValue>`; its separate `async?: true` flag controls
*guest* semantics (S01:84–98). `createSandboxClosure` can construct a branded closure
with that flag absent, even when its `call` implementation returns a native Promise.
Injecting this object, including nested under `fs.readFileSync` or a module export,
takes `copyHostValueToSandbox`'s branded-value bypass (S03:743–745; S01:443–450),
not ordinary host-function wrapping.

`evaluateCallExpression`/member dispatch reaches `evaluateResolvedCallExpression`,
which awaits `invokeSandboxClosure` (S02:2398,2622,3352). Its decisive branch is:

```text
callee.async === true
  ? normalizeClosureResult(wrapHostResult(result, stack), context.budget)
  : await wrapHostResult(result, stack)
```

Thus an unflagged intrinsic's native Promise suspends evaluation and yields its
resolved guest value at an ordinary call; rejection follows that call's throw path.
By contrast, awaiting the boxed `SandboxPromise` object does not unwrap its `.promise`.
Explicit guest `await` uses `evaluateAwaitExpression` → `awaitSandboxValue` and
`suspendJob` (S04:253–287). The internal ordinary-call branch does not release the
job: `SandboxJobQueue.run` owns execution until task settlement, while explicit await
releases/reacquires it (S06:37–45,91–99). This supports, but does not experimentally
prove, holding queued guest reactions during the sync call. Host callbacks must not
re-enter guest execution to complete that held operation.

## Reachability audit

| Configuration | Source-bounded conclusion |
| --- | --- |
| bindings; nested objects/functions; Record/Map modules | Ordinary functions are recursively wrapped. Already branded closures survive. Same-name module exports are cached during import resolution; namespace imports create separate binding records (S08:100–147). |
| Public package root/core/cli exports | `createSandboxClosure` is exported by the internal source module, **not** root/core package exports; the export map has no values subpath (S09–S11). Do not prescribe an unavailable public import. |
| entryPointArgs/importMeta; deepCopyToSandbox | Data-copy inputs, not a public intrinsic constructor; already branded closures may pass through. `run` does not expose internal `interpret`/`onYield` as a custom call-dispatch hook (S07; S01). |
| declareHostOperation, pending-call policy, resume provider, snapshots | Replay/reconciliation controls; asynchronous recorded outcomes still use boxed promises. No inspected policy changes a fresh ordinary call into transparent sync suspension (S03,S14–S16). |
| budget, clock/random, sink/observability | Metering, state or output callbacks, not an admitted arbitrary-value call override. Type violations, brand extraction/forging, monkeypatches, snapshot fabrication and source rewriting are not supported alternatives. |

A host explicitly owning a legitimate matching engine distribution could supply
its internal factory without modifying engine bytes, **if that internal-ABI binding
is separately authorized and authenticated**. No such provider is selected here.
Otherwise a supported public factory/export contract is needed. Never deep-import a
guessed private path, copy engine bodies, or mix factory and evaluator instances.

## Identity, failure and ownership qualifications

Ordinary host results get a fresh copy-state per return (S03:459–474), so repeatedly
returning one host object does not establish require-cache identity. An intrinsic can
return the same provider-owned **guest-data** object directly; `wrapHostResult`
preserves fulfilled values. Cancellation wrapping uses a persistent `seen` map,
supporting repeated-result identity within that wrapping scope (S05:17–125), not
automatic identity across independently wrapped modules/aliases/invocations.

Delayed intrinsic rejection is captured by `wrapHostResult`/`evaluateNode` and reaches
the enclosing guest try/catch (S02:394–450,3660–3680; S12:121–147). Guest exception
conversion is not arbitrary host-reason identity preservation. Cancellation races
may settle before underlying work; nullish reasons are replaced in S05:212–214.
An external provider must retain caller/control provenance and raw reasons, close
admission, observe late rejection, and drain cooperative owned resources before
public settlement. Engine settlement alone is not that barrier.

Bypassing ordinary wrapping also bypasses its journal/copy allocation machinery.
Cancellation closure wrappers do not forward properties/construct/retainedValues
(S05:42–57). The provider needs explicit guest-value validation/allocation, cache
retention accounting, host-operation caps and cleanup; no replay guarantees follow.
`run` resets the supplied Budget (S07:182–184; S13:203–215); multiple runs cannot
silently share a depleted allowance. Preserve the enclosing Shell budget separately.

## Remaining review decisions

Only unresolved: approve/reject the explicit same-instance internal ABI versus
requiring a supported public intrinsic interface; then independently review the
provider ownership/accounting design and the exact future experiment grant/caps.
The seven EXPERIMENTS.json identities are finite discrimination plans, all unrun;
they are not NP1 acceptance or a renewed execution authorization. Stop for a
different independent reviewer.
