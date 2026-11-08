# WRQ-v1 — Worker resource / quiescence alternative

2026-08-28. **SOURCE/DOCS ONLY; unselected, unimplemented, unqualified.** Zero new
Worker/engine/control executions. ROOT's follow-up after repair7b269a29 authorizes
this proposal, not execution. NP1-CJS3495d20e's **whole-guest8MiB and all-Promise
requirements remain unchanged/HOLD**. Original36, F01–F07/eight ABI evaluations,
repair-v2 and Raman's independent findings are untouched. Source bindings below
mean inspected frozen bytes, not accepted live product HEAD or measured behavior.

## 1. Source-specific mechanism

**A source-supported candidate exists without an engine patch or private
await-for-sync ABI.** Worker-local ordinary, non-async callbacks are supplied
through public `run(source, {bindings,...})` (S1). `wrapCallerInjectedFunction`
calls `invokeHostCallback`/`Reflect.apply`; `executeHostCall` invokes immediately
and its non-Promise branch copies/returns the value (S2). Such a callback can
publish a bounded request, block in `Atomics.wait`, then return text/undefined or
throw a local Error after the *parent's* asynchronous VFS operation settles.
It returns no native Promise. `invokeSandboxClosure`'s non-async branch receives
an actual value (S3). Internal interpreter awaits do not themselves make this
guest API asynchronous. This is source feasibility, **not qualified sync fs**.

The Worker agent cannot run its own message callbacks/microtasks while blocked
(D2). Therefore the parent writes the response and wake word directly into SAB,
then notifies; cancellation uses the same independent path. Neither completion
may depend on a Worker message handler, guest callback, or parent lock whose owner
is waiting for that Worker. Async fs callbacks instead return Worker-local native
Promises; S2 boxes these into SandboxPromises. Their response handlers may wait
behind a sync call; parent operations must still settle independently.

Primitive values survive the copy path; host thrown primitives do **not** survive
as the same guest thrown value: `createHostErrorValue` converts them to errors.
Local Errors copy only selected metadata (`code`, `dest`, `errno`, `path`,
`syscall`); arbitrary parent errors/objects never cross as capabilities (S2).
`copyHostResultToSandbox` creates a fresh WeakMap **per return**. Repeated returns
of one host object therefore do not establish guest identity. Injection shares
a map within that injection; cancellation wrapping has another scoped map (S6).
The import registry's wrapped-export cache (S8) is not a CJS `require` cache.
Provider-owned, invocation-local **guest** module/JSON caches must retain guest
values, reauthorize cache hits, and preserve aliases; a host-object cache is not
enough. Trusted interpreted scaffolding is a candidate, not an existing CJS API.
No factory/deep import is necessary for the proposed synchronous primitive seam.

Ordinary injection copies arguments before the provider callback. Consequently
RPC validation after that copy cannot prove original guest descriptor validation
or preallocation. Those NP1 obligations remain provider qualification gaps.

S3 holds an execution job during ordinary calls; S4 releases/reacquires at explicit
`await`. S5 Promise reactions use `runPromiseJob`, and `createSandboxPromise`
registers with the rejection tracker. Nevertheless S4's drain uses20 idle turns;
S5's tracker scans tracked records, not a complete pending/runnable census or
rejection-transition ordering proof. S1 checks the returned Promise after two
microtasks and scans unhandled rejections; it does not await every pending guest
Promise. A discarded `Promise.race([])` illustrates the distinction. Worker
blocking neither repairs nor disproves broader ordering/quiescence. Existing
Raman K1/K2 remain open; this is not a second static review or signoff.

## 2. Proposed RESOURCE-WRQ-1 contract

Keep useful NP1-CJS forms: eval, primitive print, `.cjs`, stdin source; argv/env/cwd,
stdout/stderr, fd0, JSON editing, synchronous **and** promise text VFS, POSIX paths,
explicit read/write grants and exclusive `wx`. Promise workflows use async
functions, not TLA. `.js` refuses; ESM, package search, executable local modules,
buffers, npm/npx remain deferred. Grant separation, UTF8/source BOM policy,
typed errors and irreversible publication remain NP1's functional obligations.

One invocation owns one Worker/evaluator/session, no pool/reuse/reentry. Static
trusted file entry, `eval:false`, explicit empty `execArgv`/native env, no loaders,
preloads, inherited environment data authority or ambient guest resources.
Only injected provider code owns Worker/SAB/ports. Guest code runs solely through
SafeJS; no native user-code evaluation, subprocess, fallback or runtime dependency
in core/command. Worker isolation is **not a sandbox for hostile provider code**.

| Separate ledger / limit | Proposed admission, not whole-guest/RSS accounting |
|---|---|
| Command-owned live reservations | 16MiB total; reserve source, strings, transport copies, cached JSON text and pending output *before command-owned allocation*. Strings cost2 bytes/UTF16 unit; bytes actual length; metadata256 bytes/record plus strings; each simultaneous copy charged. Never release unknown retained guest graphs against this ledger. |
| Source/context/cache | Source256KiB UTF8; context64KiB encoded;32 guest JSON cache entries, aggregate input text1MiB;4 fixed builtin module records. AST/guest graph expansion is **not** measured by these text limits. |
| I/O and RPC | Read4MiB, write4MiB, stdout+stderr1MiB cumulative; each text operation1MiB;128 operations,3 active slots; exact framing in RPC.json. Cache hits still consume operation/authorization admission. |
| External shared storage | One non-growable SAB197056 bytes =64 global +3×(128 header+65536 payload); no transferred/growable buffers or additional shared allocations. Not part of V8 heap limit. |
| Worker V8 resources | Candidate `maxOldGenerationSizeMb:32`, `maxYoungGenerationSizeMb:8`, `codeRangeSizeMb:8`, `stackSizeMb:4`; Node option units, **not a summed RSS cap or exact guest8MiB**. Startup suitability untested. |
| Execution | One5000ms admission deadline;100000 engine steps, call depth128; no per-call/reset budgets. Source/tokens65536/parser-depth128 still require actual provider admission proof. |

D1 excludes external/ArrayBuffer storage from resourceLimits and warns global OOM
can abort the process. Command-line old/semi-space flags override corresponding
limits; Worker `execArgv` itself rejects V8 flags. Require qualified parent-launch
configuration too: clearing Worker `execArgv` alone is not proof. No bounded RSS,
uncooperative cleanup or OS preemption promise is made.

Reserve before acquisition; enroll cleanup before Worker creation and immediately
own its handle/listeners. Charge once to the invocation and shared ShellBudget:
one shell command dispatch, actual shared I/O categories, same inherited deadline
and cancellation; engine steps remain an explicit provider counter, never
bytes-as-commands. Smaller parent limits win; repeated host calls/reads do not
reset quotas. Engine `run` resets its Budget (S1), so no repeated `run` may replenish
the invocation. Exact engine-step-to-shared-budget witnessing remains unqualified.

## 3. Proposed QUIESCENCE-WRQ-1 alternatives

**Q (strict):** success requires top-level settlement, truthful all-engine
active/runnable/pending/rejection accounting, parent active jobs0, published
output completion, then confirmed Worker exit. No such complete receipt is
established by these frozen seams. Unknown is not0; idle turns, top-level return,
`unref`, or a termination request are not success.

**L (explicit lifetime retirement):** require an invocation-selected policy, with
no default: `entry-return` or `guest-exit`. Entry-return retires after top-level
settlement and, for `-p`, primitive publication: useful synchronous forms remain,
but outstanding guest continuations are deliberately abandoned, not called settled.
Guest-exit supports async workflows finishing after awaited writes through modeled
`process.exit(code)`, exactly one integer0..255, no other overloads/exit listeners.
Its ordinary callback publishes the terminal request and waits until termination,
never returning/throwing back into guest. Parent latches admission closed,
terminates, drains/cancels owned work/publication, and confirms exit.
This is **not native process access**. Without a Q receipt or a selected L terminal
event, return quiescence failure, not implicit pending-job success. Both L policies
record `intentional-retirement` with pending guest work unknown/retired, never0
pending or full Node natural-exit semantics. This is an opt-in functional change.
D4 documents Node's explicit exit abandoning pending work; this proposal's owned
I/O drain is a deliberate stronger/different cleanup policy, not full Node parity.

In either profile, parent stores raw control presence/value and provenance,
including undefined/false/object reasons; identity never depends on structured
clone, error text or guest equality. Worker sees only an internal stop token.
If the guest catches a converted stop error, the parent latch still rejects effects;
qualification must show no post-exit-call guest continuation for L. Raw provider
outcomes are `completed`, `intentional-retirement`, `guest-error`, `control`,
`resource-failure`, `protocol-failure`, `quiescence-unknown`. Candidate Shell mapping:
completed→0; intentional-retirement→requested code; guest-error→1; control→existing
Shell control mapping preserving reason; resource/protocol/quiescence failure→2.
Worker terminate exit code1 is never itself guest failure/success evidence.

On cancellation/failure close admissions, atomically latch stop/wake, cancel
parent jobs, request termination after at most100ms cooperative grace, and await
actual exit plus cooperative job/output cleanup. D1's terminate Promise resolves
on exit, without a hard wall-clock guarantee. Missing confirmation keeps retirement
unproven and forbids success/reuse. Confirmed exit retires Worker state, **not**
parent VFS operations or their effects. Late settlements remain observed; preserve
primary and secondary cleanup errors. No rollback. Closed stdout rejects only
that destination's further output; it does not invent cancellation of sibling
file/stderr work. A failed publication cannot become a clean completion receipt.

## 4. RPC, closure and review boundary

RPC.json is a finite proposed protocol, not executable code. Payload ownership
passes only through atomic state/sequence transitions; no concurrent payload
writer, no slot reuse before acknowledgement and real operation cleanup. Parent
control is a permanent latch independent of slot ownership. Async slot responses
may remain unconsumed while the sync slot progresses. Parent retains effects and
job records even if the Worker disappears. Stale responses cannot write a reused
slot; each late settlement is still accounted for. Refuse malformed requests,
unknown authority and exhausted reservations before starting that operation;
earlier valid statements/effects are not undone.

A new review/seal must bind static parent/Worker entries, all engine/transitive
imports, generated source/output identities if compilation is separately authorized,
Node binary/native dependency/launch configuration, fixed protocol, cache scaffold,
capture and cleanup ownership. Existing66 source/all18/four-tool pins are historical
inputs, not automatically a complete Worker loader closure. The old private-ABI
entry/factory is unnecessary here. Unknown loads STOP; no automatic closure growth,
private checkout, package installation, worker loader thread or child Worker.
Node22.15.0 is the documentation comparison;22.22.2 is the historical recipe tool,
not newly executed/qualified. CASES.json is a separate finite obligation matrix,
not an engine grant, claimed passes, or CLI-coverage replacement.

## 5. Exact remaining ROOT decisions / handoff

1. Keep NP1 unchanged/HOLD only, or select separately named RESOURCE-WRQ-1 with
   the candidate limits above, explicitly foregoing exact whole-guest8MiB/RSS.
2. For that new profile choose Q (complete accounting still required) or L
   (mandatory invocation-selected entry-return/guest-exit policy, explicitly
   intentional retirement rather than implicit pending-job success).
3. Decide whether an unconfirmed Worker exit/uncooperative parent drain may leave
   invocation settlement pending under host containment. If a hard completion/RSS
   bound is mandatory, this one-Worker proposal does not establish admission.

No choice here reopens settled optional injection, zero core dependencies, VFS
grants or excluded command scope. No implementation or execution is authorized.
ROOT can relay this sealed source-only proposal to Raman for **different review**;
source feasibility, revised contract selection, provider qualification and runtime
evidence remain separate gates.
