# Post-repair provider hooks — proposals only

2026-08-28, **after coherent repair checkpoint
7b269a291d9fdc76e0760d36446d937e54060757**. The ten inert harness controls repair
ownership/receipt evidence; they execute no engine. The unchanged eight future
bridge evaluations remain separate and unrun. Neither cohort qualifies NP1-CJS's
whole guest preallocation or all-Promise quiescence requirements. Raman790a K1/K2
remain HOLD; original7/36 and contract3495d20e remain unchanged.

## A. Preserve NP1-CJS: required qualifying-provider hooks

These names are proposed interfaces in markdown, **not existing SafeJS exports**.
The optional provider must supply hooks or an independently qualified equivalent
reservation proof covering every admitted path. Native JSON allocation followed
by a copy check, or string/array allocation followed by a size check, is too late.
Retained/provision APIs exist; that does not make them an automatic whole ledger.

| Required hook/record | Exact responsibility and owner |
|---|---|
| `reserveParse(sourceBytes, nextTokens, nextDepth, nextAstNodes)` | Provider parser calls the invocation ledger before descent/token/AST allocation; no unmetered parser hidden inside run. Enforce source256KiB/tokens65536/depth128 before the relevant allocation. |
| `reserveAllocation(kind, ownerRef, logicalBytes, nodes) -> Ticket` | Before object/array/error/closure/Promise/reaction creation, property growth, string result and guest-value copying. Same ledger for builtin, interpreted and private-intrinsic bypass paths. Command owns quotas; provider owns truthful engine event coverage and session refs. |
| `commitAllocation(ticket, guestRef)` / `releaseUnused(ticket)` | Exactly one commit; failed allocation releases only unused reservation. Cumulative32MiB never refunds actual allocation. Live+reserved8MiB uses the original NP1 units, not native heap/RSS. Tickets cannot cross sessions or be reused. |
| `beforeStore(ownerRef, key, oldRef, newRef)` / `retireRoot(ref)` | Reserve before insertion/resize/mutation; maintain actual roots/edges and alias identity. Release a graph only with qualified reachability evidence; otherwise retain its charge. Cached aliases do not duplicate objects, but reference cells still count. |
| `reserveNativeResult(operation, provenUpperBound)` | Before native JSON/string work. JSON needs a bounded validation/counting pass or bounded parser before graph construction, including keys/edges/strings and temporaries. Slice/trim may use a justified conservative length reservation before invoking the native method. A guessed bound or after-copy measurement is not proof. |
| `promiseCreated(ref)` / `reactionCreated(parent, child)` | Before allocation; register **all** guest promises, including discarded, async-returned, adopted and derived values. Track active frames, runnable reactions and admitted host operations under the same session. No tracking only at host-call boundaries. |
| `promiseSettled(ref, state, rejectionSequence)` / `handlerObserved(ref, edge)` | Stamp actual Pending→Rejected transitions monotonically, not promise creation/Set iteration order; record handling propagation along real reaction edges. Caller/control reasons stay in the host provenance channel, separate from guest errors. |
| `checkpoint(epoch)` / `stopAndRetire(control)` | Atomically stop new guest admissions and prove active/runnable/pending/host counts at the selected checkpoint. No success until every required count is0. Reactions cannot enqueue after a quiescence receipt. Stop must retire owned jobs/resources without calling guest handlers after terminal output closure. |

Each record needs same-instance evaluator/factory and session provenance, exact
source/build/adapter identities, operation ordering and actual engine witnesses.
A provider's boolean `qualified`, declared high-water number or all-zero receipt
does not establish coverage. Instrumentation must precede side effects and retain
raw first-reason presence, including undefined, through cooperative closure.
There is no new per-call Budget and no bytes-as-Shell-commands mapping.

Raman's bound source observations identify the missing coverage: console-json.ts
82–85/367–390, interpreter.ts505–578/455–465, methods/string.ts175–192, budget.ts
115–214 and run.ts182–186. These are source observations at enginebb23ec27, not
new overruns. Budget's explicit retained/provision functions are acknowledged;
their existence does not prove preallocation at every listed operation.

For K2, jobs.ts49–56's20 idle/generation turns and promise-tracker.ts24–94's
tracking/Set scan do not supply the specified all-Promise/retirement receipt.
Raman's existing source-only A/B rejection-order discriminator remains unscheduled.
No new engine case is added here: F03/F07 already cover the separate sync-turn versus
explicit-await ordering concern. Successful future F03/F07 would not prove K1/K2.

An alternative legitimate provider might satisfy these hooks without changing the
frozen reference engine; this packet neither establishes such a provider nor proves
one impossible. No private-engine patch, automatic import, native/eval fallback,
runtime dependency, implementation or registration is authorized.

## B. Possible command-owned alternative — a different product/profile

**VJSON-BATCH-CANDIDATE**, if ROOT separately chooses it, would accept a bounded
data-operation document, not JavaScript/CJS: at most8 explicit read/parse/set/stringify/
write operations, explicit text VFS grants, one invocation-owned JSON graph. A
command-owned incremental parser reserves each graph node/key/string before creation;
bounded UTF8 input, owned chunks and incremental output avoid an unbounded native
JSON.parse/stringify intermediate. Actual VFS bounded-read and exclusive-write
contracts remain prerequisites. Conservative reservations may refuse before work.

Such an implementation could honestly account its **entire command-owned graph**
under a separately specified8MiB logical ledger because there is no guest realm,
arbitrary JS allocation, discarded guest Promise or interpreter job queue. Its
finite asynchronous host operations can be registered before acquisition and
retired explicitly. This is a plausible ownership design, not implemented evidence;
it still cannot bound provider RSS or force uncooperative host cleanup to finish.

It would **not** provide node -e/-p/.cjs, process objects, ordinary mutable guest
values or Node compatibility, and cannot fulfill the requested Node command by
renaming it. It must not replace NP1's whole-guest8MiB claim with a staging-only
claim. ROOT must select this changed scope/new profile and require a new contract,
preseal and different review before any implementation. Otherwise keep NP1-CJS
unchanged and its provider-qualification HOLD in place.

## Stop

Repair review/engine GO, provider hook qualification, adapter guarantees and actual
command/CLI acceptance remain distinct gates. This proposal schedules no experiment,
weakens no cap and claims no reviewer signoff. ROOT can relay it to Raman alongside
the separately sealed repair evidence.
