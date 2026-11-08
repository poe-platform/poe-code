# ROOT selection L — append-only decision record v1

2026-08-28. **DOCUMENT/DATA ONLY. No implementation, runtime or experiment GO.**
Authority is ROOT's current user-message decision, not a fabricated decision
commit, branch check or previous proposal's suggestions. BINDINGS.json authenticates
the exact committed inputs inspected here; no moving HEAD acceptance is asserted.

## Selected facts

- ROOT selects the Worker alternative direction **L: explicit lifetime retirement**,
  **not Q/all-jobs-settled**. Q remains historical proposal data, not selected work.
- RESOURCE-WRQ-1 may be evaluated as a **separate** profile: proposed16MiB
  command-owned ledger, fixed197056-byte SAB, and separate V8 limits. These are
  **not RSS or whole-guest8MiB guarantees**. Original NP1 remains unchanged/HOLD.
- Selection does **not** choose entry-return versus guest-exit, ratify every numeric
  parameter, establish a qualifying provider, or authorize execution.
- Parent VFS jobs remain owned. Actual Worker exit and distinct parent cleanup are
  required; unknown exit/uncooperative cleanup is unsafe/unproven, never clean.
  Cancellation preserves actual parent reason/priority, wakes blocked synchronous
  calls, terminates the Worker and retains parent cleanup ownership.
- No fallback or guest access to Worker/SAB/ports/native filesystem/native process.
  Optional qualifying provider injection and zero core/command runtime dependencies
  remain requirements. Eight historical private-ABI evaluations stay held/unrun,
  separate and potentially unnecessary for this path, not deleted.

## Candidate L-CUT-1 — proposed details, not ROOT-ratified semantics

This deliberately finite policy drains **parent-owned admitted work**, not the
engine's entire job queue. It preserves useful synchronous eval/primitive print/
`.cjs`/stdin and text-VFS JSON workflows. Async workflows needing subsequent writes
must finish them before their selected terminal trigger; entry-return does not
promise to run the continuation of a previously launched async function.

### 1. Trigger and admission ordering

Two trigger candidates remain open, with no default:

| Trigger | Exact proposed event and limitation |
|---|---|
| Entry-return | Worker observes the **validated normal result of its single bound entry evaluation**, then closes its local guest-host-call gate and reports terminal intent. For public frozen `run`, this means that API's actual result settlement, including its existing internal scheduling, **not** an invented top-level/all-jobs checkpoint. A `-p` primitive output must already be admitted as a bounded parent-owned publication before the parent cutoff; it cannot be added afterward. |
| Guest-exit | A separately qualified modeled `process.exit(code)` accepts exactly one integer0..255. Its ordinary callback closes the local gate, reports terminal intent and waits for termination without returning or throwing into guest. No native process capability is exposed. A normal entry result without this trigger is not implicit permission to retire successfully. |

Parent owns one serial admission record and an irreversible OPEN→CLOSED latch.
Each accepted operation gets a monotone parent ordinal; cutoff consumes the next
ordinal once. With the existing candidate128-operation ceiling, the derived bound
is129 ordinals including cutoff, not129 available operations or a new quota.
These parent ordinals are distinct from the SAB notification/wake epoch.
This is proposed parent-local metadata, not an assertion that old RPC already
implements an epoch. A future wire/entry revision must bind its exact encoding.

Effect admission is one synchronous, non-reentrant parent transaction: validate
owned session/sequence, route/grant, reservations and OPEN state; enroll the actual
operation and cleanup; then call its host operation. No await between final latch
check and enrollment. Writes/output require complete bounded parent-owned payload
before this effect admission. Partial transport reservations are not admitted VFS
writes/output; at cutoff they are discarded/reported without starting effects.
Read admission owns its complete bounded stream/decoder/cleanup obligation.

The **parent cutoff commit**, not Worker posting time or a callback's start, is the
linearization point. In-flight requests admitted before it belong to the drain
set; requests merely sent, queued, validating or staging at it cannot acquire new
effect authority afterward. Terminal and cancellation routes share that latch.
The first cutoff is immutable; later caller cancellation can still change outcome
selection according to existing priority, without reopening admission.

### 2. Normal retirement and finite service boundary

Freeze the admitted operation set at cutoff. Request Worker termination and drain
those parent reads/writes/output operations to observed settlement and resource
close. **Normal retirement alone does not abort already admitted VFS work.** Its
previously bound effects/publication may occur after cutoff; no rollback is promised.
Do not admit another path, write, output frame, metadata lookup or guest-triggered
operation from its completion. Backend work already within that bounded operation
remains covered by its existing ownership/grant, not newly expanded authority.

After cutoff do not deliberately deliver remaining RPC results to guest or schedule
guest continuations from them. Already delivered responses may already have queued
engine reactions; those can run until termination, but cannot acquire host effect
authority through either closed gate. No claim is made that they never execute,
finish successfully, or are all counted. Host settlement need not wait for a
Worker ACK after terminal cutoff; confirmed exit retires the transport/session,
**not** a fabricated ACK, reusable slot or completed guest continuation.

This candidate supplies **zero additional post-cutoff guest continuation service**.
Thus a read started by a discarded async function can finish at the parent while
its guest write continuation is abandoned. A guest-exit workflow can instead await
its writes before explicit exit. More continuation service would require a separately
specified finite provider mechanism and new review, not idle-turn inference.

Keep exact parent counts for admitted/settled/active/closed operations and committed
output bytes. For engine active/runnable/pending/unobserved work retain `unknown`
where no complete observation exists. Report `intentional-retirement`, the chosen
trigger, cutoff ordinal, known undelivered RPC outcomes and **guest continuations
possibly abandoned, count unknown**. Confirmed exit retires Worker state; it never
means abandoned promises settled. No all-engine finite count is manufactured.

All operation/slot/frame/byte/step/deadline limits are inherited candidate WRQ caps,
not reset at cutoff, per RPC, retry or drain. In particular128 operations/3 slots,
5000ms execution-admission deadline,100000 steps,4MiB reads/4MiB writes/1MiB output
remain proposed, not newly ratified. Cleanup has no fabricated fresh time budget
or bounded completion promise. Expiry uses the existing control/containment route;
missing exit or host closure keeps ownership unsafe/unproven, never deadline success.

### 3. Failure, cancellation, publication and status

On caller cancellation close admission, retain raw parent reason **presence/value
and provenance** (including undefined/false/object identity), set the shared stop
latch/wake epoch independently of Worker callbacks, cancel cooperative parent work
and request termination. No raw reason identity is inferred from cloning, guest
equality, strings, or AbortController defaults. Observe late settlements and close
failures through the same idempotent parent cleanup barrier. Normal drain does not
cancel admitted work merely to retire guest state; cancellation explicitly does.

Apply existing live AGENTS priority: **root-caller cancellation > escaping
execution/control failure > local cancellation**. This record adds no caller/error
tie-breaker, provenance inference or escalation from an already mapped result.
Future integration must bind the exact Shell mapping/cleanup contract; the prior
proposal's candidate status numbers are not ratified by L selection.

Proposed normal-success condition: valid selected trigger, all preadmitted host
operations settled/closed with reconciled outcomes, all admitted output publication
settled, confirmed Worker exit and parent cleanup, and no retained failure/control.
An ordinary FS rejection delivered through the guest bridge before cutoff follows
the guest execution outcome; it is not automatically an escaping host failure.
Delivery itself is not proof that every guest rejection handler ran. A known parent
rejection not delivered before cutoff is a retained failure, even if an abandoned
guest handler might have caught it: this conservative policy is a declared
compatibility difference requiring review. Failed/partial output or cleanup cannot
be erased by exit code0. Closing stdout alone does not cancel sibling VFS/stderr
work. Preserve actual bytes/effects and primary plus secondary failures; no rollback.
Worker termination's own exit status is not the modeled guest status. A clean
ownership record is distinct from requested nonzero guest status; unknown ownership
permits neither clean status0 nor session reuse/public cleanup settlement.

## Narrow review obligations and remaining choices

OPEN-OBLIGATIONS.json maps exactly WRQ01–WRQ08, without altering their inputs,
denominators or outcomes. WRQ04's Q variant is now **not selected**, not passed or
deleted; its L variant remains unrun. Existing inputs do not by themselves prove
cutoff races, `-p` publication or every modeled-exit condition. Those gaps must be
bound in a narrowly versioned preseal before any later execution, not claimed here.

Remaining ROOT choices: **(D1)** choose entry-return, guest-exit, or explicitly
invocation-selected support for both; **(D2)** accept or revise L-CUT-1's zero
post-cutoff guest service, complete-payload admission and conservative late-host-error
policy, including exact Shell status mapping; **(D3)** ratify concrete resource/
deadline/containment admission details, including treatment when actual exit or
cooperative closure cannot be confirmed. Unconfirmed ownership is already forbidden
as clean; no decision here can relabel it successful. Q-versus-L and NP1 preservation
are settled and are not re-asked.

Future different review must bind exact static parent/Worker entries, actual loader/
tool/source closure and launch configuration, gate/epoch ownership, result schemas,
shared-budget/deadline mapping, output and raw-control provenance, termination and
parent-drain capture, plus all revised per-identity expectations. No driver, launch,
authorization token, implementation or execution is supplied.

## Verified immutable repair handoff

| Seal | Full verified value |
|---|---|
| Repair code commit | `7b350bf7472cabfc2e5ed699f19c2a1c8bde2f98` |
| Recipe manifest SHA256 | `3b4169c6dcb15f5f9d43e08fd417c93a38004604404cebab724cb44dbeae5f8c` |
| Repair evidence commit | `7b269a291d9fdc76e0760d36446d937e54060757` |
| EVIDENCE.json SHA256 | `9c3df4e3ee40e9c9bc03ba6aa7f0816a3123afdf9aec897f008b76e9a4518b58` |
| Source manifest SHA256 | `a670629995f8cb7331a5e24d35ad4bb185dc0fbe5f70de8281598de615cd35b1` |
| Tool manifest SHA256 | `4efc7ff6181d6f92dd9aa3fe67803c55af027adc734b701582998efb452ae788` |
| Worker proposal commit | `53e5bffd5e808b198cfda2ff3a5cedccf88990e9` |

Repair handoff: `tests/commands/node-provider-experiments-20260828/repair-v2/HANDOFF.md`
at the evidence commit; SHA256
`2d32c9dcca77beef5276c76fd86867957de960f0a7058ae05e200efcc8a17809`.
BINDINGS.json records stored commit/blob identities, byte lengths and fresh hashes
of those committed artifacts, not new engine/source/tool execution qualification.

Preserved history: Raman9 observations/four closes (2 natural,2 SIGTERM); L02 was
reviewer rescue, not subject reap. Repair10 controls/seven closes (4 natural,
3 SIGTERM), no rescue; C06 rejected source identity, C10 was separately presealed.
These are inherited authenticated reports, not reruns or rescoring. Main eight
engine evaluations remain0. This task adds **zero executions of any cohort**.
