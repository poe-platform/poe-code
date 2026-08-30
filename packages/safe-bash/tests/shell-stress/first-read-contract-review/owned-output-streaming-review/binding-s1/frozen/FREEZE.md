# Independent reduced streaming review: frozen intentions

Preparation only. Exactly **12 logical acceptance cases: five distinct explicit
API-opt-in positives and seven independent controls**. Parameters/subruns do not
add logical cases. Product executions: **0**. No independent pass, candidate
qualification, production permission, or superiority claim follows from this file.

## Authority and chronology

The latest user decision and
`/tmp/safe-bash-owned-output-streaming-coordination.txt` govern this review.
Reject cancellation by prebuffering; no new lease/borrowed-input API. This freeze
precedes all new-author declaration, implementation, and test-body inspection.
Before freezing, the reviewer read applicable AGENTS, coordination, git metadata,
the original historical input manifest, and lines 1–105 of the original public
REPORT at `3eba797a2f286c80149dff22afbcd177e3ffea08`. That report includes historical
contract descriptions; no new candidate material was inspected. This is a
chronology statement, not a guarantee of blindness across agents.

Observed preparatory HEAD: `84ab66ca717e0dff21abf57051b41cb553f3c7f3`, at
2026-08-27T10:58:34Z. Neither it nor root's initial
`76fe3b86726d5e55624c83d923f95a6eb5ad513c` identifies a new candidate.
Immutable historical identities, never current-candidate aliases:

- Baseline review: `3eba797a2f286c80149dff22afbcd177e3ffea08`.
- Previous v1 evidence: `1ff82cb748c60145740dba354610ac7ed7a7f15f`.
- Rejected prebuffering v2 source: `9b65787d4d6805aa182ff138996bf4ab7bacd764`.
- Prior independent review: `688c4623fbdc708f0ba07f9c69a19fb70338047d`.

## Historical inputs and denominators remain immutable

The original five and their stage assertions remain unchanged and separate:
baseline 0/5, previous 1/5. These new positives do not rename or repair them.
Authoritative inputs are the byte-preserved archives at the baseline commit:

- `preserved/tests/shell/first-read-probe.ts.data`: SHA-256
  `b138e5572240533efb8cde733e0c5a9bbd1c960e431b9291c0a17a300b1c7ed6`.
- `preserved/tests/shell/remote-close.test.ts.data`: SHA-256
  `0ca0886333c793dbddb5e14e2fdbb2a3bb457919dbf4e70d419f87fab6505474`.
- `preserved/tests/stress/remote-cancellation/helpers.ts.data`: SHA-256
  `9e76ecf9ba6604fc2c4b94a96cf5b46ffed97de5e7d0c2524e138b4410e17678`.

Paths above are relative to `tests/shell-stress/first-read-contract-review/`.
Its `evidence/inputs.json` git blob is
`a53538bc9a39349f7acaba9d4daf37932b634b91`; it binds the other original inputs.
Original input bodies have not been read during this preparation. Later binding
must extract the exact existing commands, one-start barriers, and deadlines
without changing historical bytes. The public report identifies the common
`producer | head -n 0; true` shape, inner 1200ms bound, outer 3000ms/1MiB bound.
Do not replace those commands/deadlines to obtain a positive result.

Retain prior new-seven 3/7 and every failed profile as history, not acceptance.
D01 handback/framing/full-cursor conservation is not a user requirement or
ordinary curl acceptance. D02/D03/D07 are not bugs under unchanged top-level
Shell.exec ownership. Existing 57+9, native 0/7/141 reference, and old-sixteen
initial 15/16 versus corrected 16/16 remain distinct; none is replayed in prep.

## Shared observation contract

Record binding evidence separately from product behavior. Record separately:
public result, operation closure, cooperative cleanup settlement, whole-stage
abort/reason, caller abort/reason, and independently live input-owner lifetime.
Do not infer stage abort from caller state or infer a body iterator read from a
server GET counter. Successful operation close does not assert whole-stage abort.

Register cooperative cleanup synchronously through existing registerCleanup
before owned IO/admission; the registered path and finally share idempotent
completion, including overlapping calls. Refuse late owned acquisitions after
closure. Drain admitted registered cooperative work, not arbitrary opaque host
work. Existing top-level owner cleanup stays allowed and unchanged.

Known cat/curl owned IO boundaries auto-enroll. Arbitrary custom plugins opt in
explicitly using the author's declared API, not an invented API. No global
stage auto-cancellation, strict demand gate, or zero-start replacement policy.
An operation cannot return/cancel independently borrowed stdin or cancel
independent sibling/file/stderr work. Already-consumed bytes may be discarded;
no rollback, suffix preservation, handback, or one-chunk framing requirement.

## Five explicit API-opt-in positives

Each uses its corresponding original command, one-start barrier, fixture
behavior, and bounds, in a NEW distinctly labeled binding. Explicitly bind the
owned-output lifetime, using custom-plugin opt-in where necessary; exercise
known command auto-enrollment rather than manually replacing its product IO.
Keep the original five entirely untouched. Observe cooperative resource closure
and cleanup before teardown, successful empty public output as applicable, and
caller/stage state independently. Operation-only closure must not be mislabeled
as whole-stage cancellation. A stage that remains live must not lose unrelated
work. A missing declaration/binding is BLOCKED, never silently a pass or waiver.

| ID | Original identity | Frozen positive intention |
| --- | --- | --- |
| S01 | first-read-local | After the one-start barrier, actual stdout closure closes explicitly output-owned cooperative pending source work before first output. |
| S02 | first-read-s3 | Same original mock/file scenario; automatic known-command enrollment closes the owned pending file transfer, not its independent owner. Mock evidence only. |
| S03 | first-read-webdav | Same original loopback headers/body-withheld scenario; owned request/body cleanup settles on actual output close without inferring client read counts from GET counts. |
| S04 | first-read-curl-body | Same original authorized loopback GET/body-withheld scenario; known curl owned output closes cooperative transfer work before a successful stdout write. |
| S05 | first-read-curl-headers | Same original response-headers-pending scenario; owned output closure reaches the request acquisition lifetime, not merely a later body-copy loop. |

## Seven independent controls

### S06 — streaming, producer reuse, and backpressure

Use bounded task-owned loopback upload and controlled producer/sink variants.
Keep EOF unreleased until the server actually receives request-body bytes. Only
then permit EOF and assert full uploaded bytes. A fully buffered implementation
must therefore fail the streaming observation, not pass after EOF is released
by a timer or teardown. Include retained reused-Buffer fragments mutated only
at producer advance/finalization, and a stalled awaited sink write with bounded
read-ahead. Verify owned retained bytes and downstream backpressure separately;
do not require every transient completed write to copy, zero read-ahead, or
protection from arbitrary concurrent mutation. No chunk-boundary conservation.

### S07 — stdout-only curl closes while borrowed-input owner lives

Use legitimate nested context.invoke sharing or an explicit borrowed scope
supported by the actual declarations. Keep the independent stdin OWNER LIVE
across operation closure and assertions. Actual stdout close must reach
stdout-only request/upload work through an honored signal and settle cooperative
cleanup. Operation closure itself must not return/cancel borrowed stdin. Observe
before owner finalization; normal later owner return is allowed. Use a streaming
upload variant; no requirement to recover already consumed bytes. A direct
top-level Shell.exec input alone does not prove borrowing. No artificial framing.

### S08 — required mixed effects stay live

Parameterize curl output destinations so stdout closure coexists with required
body-file, header-file, and writeout work, including independent stderr effects.
Use positive byte/content/status observations, not merely missing abort flags.
Keep request/upload alive for those required effects, and exercise stderr and
independent file work in the actual command/invocation context. Close only the
stdout-owned operation; do not let successful stdout cancellation erase required
effects or silently abandon their cleanup. No external-provider coverage claim.

### S09 — explicit three-level lifecycle, late admission, and drain

Build explicit parent/child/grandchild ownership through declared operations and
existing registerCleanup. Establish registration-before-IO ordering, close
admission, reject/refuse attempted late owned acquisition without starting it,
and await already admitted registered cooperative descendants. Overlap registered
cleanup and finally; require shared idempotent completion. Distinguish public
settlement from cleanup and stage state. Parent drainage covers registered
cooperative children only, not unregistered arbitrary host promises.

### S10 — child and sibling isolation

Close one child while its parent and an independent sibling remain live and do
observable useful work. Include independent file/stderr positive effects and
borrowed input-owner liveness where bound. Child closure must not close its
parent, sibling, or independently borrowed stdin. Then deliberately close the
parent and observe its registered cooperative drainage. Do not infer isolation
only from signals when effects can be asserted.

### S11 — caller abort and error precedence

Use caller-driven cancellation and IO-failure interleavings with controlled
ordering. Include exact falsy abort reason 0; preserve reason identity rather
than replacing it via truthiness/default EPIPE. Check established authoritative
caller/error precedence against the actual declared contract, and record
first/late failure ordering separately; no newly invented race winner. Cleanup
must not mask an established failure or leak an unhandled late rejection.
Public error/result, operation closure, and stage/caller state remain separate.

### S12 — opaque pending-read truthfulness

Use a bounded, deliberately uncooperative read and observe its still-pending
state separately from public/operation/registered-cleanup state. Do not demand
preemption, universal drainage, or universal nonhanging behavior. No operation-
initiated return/cancel of independently borrowed input. Release or reject the
task-owned opaque fixture explicitly for final teardown, observe late errors,
and report which settlements occur before versus after that release. A report
must not credit forced fixture release as product preemption or a cleanup pass.

## Execution gate and optional negative control

No candidate import/runtime before author ACTUAL CLOSED plus an authenticated,
immutable `/tmp/safe-bash-owned-output-streaming-prototype.ready`, followed by
root's fresh executor launch. Root forwards declarations only after this freeze.
Bindings await that handoff; the freeze does not invent names/signatures.

One optional separately labeled sealed-v2 prebuffer negative control may use
S06's EOF gate to demonstrate rejection of the old buffering approach. It is not
a thirteenth acceptance case, a reinterpretation of prior results, or promotion
permission. Plan only; no execution during preparation.

Only later execution may start bounded task-owned loopbacks/children, with owned
process groups tracked and reaped. Captured code remains inert .data/.patch-data;
executable copied TS belongs only in unique reviewer TMP. No deps/install,
root-dist, global typing, full suite, release gate, or new native/external breadth.
Preparation ends normally after its finite work; no polling, dormant processes,
SIGSTOP, or candidate execution even if author readiness arrives meanwhile.
