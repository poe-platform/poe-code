# Independent NP1-CJS candidate contract review

2026-08-28. Candidate `3495d20e5d52c3fb90666b2453ed0a964a14a8ce`, compared with
independent `4362f91f98f2a8b56683a3a33e9fb582153af416` and root selection
`85aff4ff877c2b25e4cd7e4c2a21a240dcc3247a`.

**Verdict: implementation/provider-qualification HOLD.** The finite contract is
substantially more complete and candidly labels G2-G4 as unproved. Its requirements
are not evidence that the frozen SafeJS engine can enforce them. No implementation,
provider experiment, compiler, package or actual guest execution occurred here.
The separately reviewed bridge has its own harness HOLD; that is not an NP1 bug.

## Contract closure and preserved history

The author now specifies `.cjs` only; `.js`/extensionless/.mjs refuse before lookup;
no package search or readdir; exact CLI forms and entry/state schemas; explicit
source/data/JSON/stdin/output/write grants; missing-write ERR_VNODE_DENIED distinct
from granted EROFS; JSON requires both jsonModules and dataRead. No ambient authority.
JSON cache objects are same-session guest values, not repeated host copies. TargetRef
does not grant a stale path lease. `wx` means real exclusive creation or pre-mutation
ENOTSUP, not lookup then write. UTF8 split/tail replacement, lone-surrogate encoding,
source/JSON BOM stripping versus data preservation, and diagnostic/grant/output
limits are concrete. Actual backend confinement/bounded read/wx proofs remain absent.

Original36/33 source records stay unexecuted and unchanged. The versioned mapping is
**24 included-as-is,9 adapted,3 deferred**, not a result score. Ten closure identities
contain24 proposed variants; original compound siblings and independent holdouts
are not silently absorbed into that count. N21's actual LF inside a quoted source
string is preserved; only its mapped variant changes to backslash-n. N08/N30 ESM
literals and N24's old package-sensitive protocol stay deferred; C01/C02/C05 carry
separate CJS obligations. No Node syntax checker was used to evaluate these programs.

New candidate choices are explicit versioned proposals, not old-byte parity:
primitive print now renders -0 as0; console accepts0..16 primitives; file-only
filename/dirname are added; promise fd0 text input is admitted; hashbangs refuse.
Do not claim all original NP1 behavior is unchanged merely because24 mapped rows
retain their literals. No original assertion or diagnostic is retrospectively scored.

## Concrete accounting boundary: K1

The public66-source archive is authenticated in the bridge review's `INPUTS.json`.
The following are **source observations**, not measured overruns or a universal
impossibility result. Member paths refer to that archive at
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, not a private checkout.

| Path and physical lines | What is actually visible | What it does not establish |
| --- | --- | --- |
| `src/interp/globals/console-json.ts:82-85,367-390` | Native JSON.parse constructs a host graph before copyJsonToSandbox; the subsequent copy checks strings/array length. | The proposed before-allocation graph/property ledger, incremental parser reservation or cumulative32MiB allocation cap. |
| `src/interp/interpreter.ts:505-535,545-578` | Array allocation/push precedes allocateArrayLength; object literal allocation/property definitions occur in the evaluator. | Pre-insertion reservations for every object/property via a command-owned host request counter. |
| `src/interp/methods/string.ts:175-178,191-192` | Native slice/trim results are arguments to allocateString. | Preallocation admission for their produced strings. These are admitted NP1-CJS methods, not only excluded repeat/regex methods. |
| `src/interp/budget.ts:115-143,149-191,203-214` | Per-value checks, reconciliation, explicit retained/provision APIs and reset exist. | One automatic NP1 ledger covering all guest allocations, its exact proposed units, or cumulative allocation accounting. Do not deny the existing explicit retained/provision APIs. |
| `src/interp/interpreter.ts:455-465` | reconcileDataBudget measures retained values and a transient value. | Reconciliation of already existing values is not proof of reserving before they were allocated. |
| `src/run.ts:182-186` | run resets its Budget and calls parseExecutableModule(source, filename). | The NP1 token/AST/depth reservation table is not supplied to that parser by this call. Source length admission alone is not that table. |

Command-owned staging can independently count bounded context/source/input/output
bytes, validate request/grant records, reserve adapter operations and account its
own copies. Even those claims require bounded producer/VFS contracts; checking a
returned huge buffer afterward is insufficient. Such staging does **not** observe
every guest object literal, native JSON allocation, string method, closure or reaction.
An intrinsic factory bypass makes explicit guest-value accounting more important,
not automatic. A self-reported zero/high-water number is not an allocation witness.

**Required resolution:** identify actual provider hooks or a sound, independently
qualified reservation proof covering these exact paths and their retention units.
Otherwise retain G2 as unmet or seek a separately ratified weaker scope. Do not
silently relabel8MiB as only command staging, reinterpret engine dataSize as the
same ledger, broaden native authority, patch the private engine, or declare the
whole profile impossible. The eight tiny bridge evaluations cannot close K1.

## Quiescence boundary: K2

The contract deliberately requires every unresolved guest Promise, active frame,
reaction and admitted host operation to retire, including discarded promises; it
selects unhandled failures by rejection sequence. These are exact new obligations.

In the authenticated engine, `src/interp/jobs.ts:49-56` drains after20 unchanged
generation/idle turns. `src/interp/promise-tracker.ts:24-44,47-65,90-94` stores records
at tracking time, records rejection/observation, scans Set order after microtask
flushing, and does not expose the proposed complete pending/retirement receipt.
That is not the contract's all-Promise quiescence hook or rejection-sequence proof.

A finite, **unscheduled source-only discriminator** is to create promise A, create
and reject B, then reject A before the checkpoint. The contract chooses B by rejection
order; the shown tracker iterates tracking order. This is a hook/selection gap to
resolve, not a newly executed case or an assertion that a future provider must reuse
that tracker. C09's unresolved/handled/unhandled cases remain planned, not proofs.

## Genuine Sync ordering: already covered prospectively

Do not qualify Sync by resolved value/typeof alone. Existing bridge **F03** queues
`Promise.resolve().then(()=>mark('job'))` before the ordinary branded read. The
driver waits for actual read admission, then requires empty guest marks and an
unsettled engine while held. After release it requires exactly
`[true,2,'after','job']`. Thus the reaction must eventually run, but only after the
read and following statements. **F07** contrasts explicit await: `['job']` while
held and `['job',true,2,'after']` finally. F02 distinguishes ordinary Promise boxing.

These are actual same-guest observable ordering predicates, not host-clock/native
Node timing. The bounded readiness checkpoint alone is not the proof; the final
ordered marks and actual load/resource witnesses are also mandatory. Both cases
are still unrun. **No additional evaluation or duplicate order experiment is added.**
If the future F03/F07 run fails, do not silently forbid mixed jobs or weaken ordering;
any narrower refusal profile needs separate root selection.

## Identity, permissions and terminal selection

Version/source labels do not establish same engine instance, live guest identity or
retirement. The dedicated host reference entry uses explicit authenticated private
factory/evaluator imports; this is a permitted test adapter, not a core autoload,
guessed path, public factory export, global provider qualification or guest capability.
An actual provider still needs stale/foreign refs, cache aliases, mutations, channels,
native result validation and before-allocation ownership across all admitted syntax.

Closed stdout now noncatchably ends guest scheduling, does not cancel admitted
sibling file/stderr work, and rejects the actual destination reason after cleanup.
The selected single-command EPIPE→141/empty diagnostic rule is source-consistent
with the author's pinned `4dadc2a0...:src/shell/runtime.ts:1557-1578`; ordinary
undefined/TypeError mapping is likewise distinguished from root-caller rejection.
This source is explicitly **not an accepted product baseline** in BINDINGS L5.
Actual raw/Shell binding and retirement evidence must precede integration acceptance.

## Next handoff

Keep the functional slice and deny-default rules. Close K1/K2 with concrete provider
hook/ownership scope, not another generic provider promise. Preserve declared logical
caps and absence of RSS/hard-preemption claims. The bridge may separately qualify
its fixed sync/identity/cancellation observations after its own harness repair and
fresh review/root GO; success would not qualify NP1 grammar, global allocation,
all-job quiescence, VFS authority, CLI, package exports or a working Node command.
