# Capture Accounting and Phase Deadline Correction Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Specify the additive FC-F02/FC-F03 source correction for separate review without granting execution or changing the accepted cohort.

## Normative Language

MUST, MUST NOT and REQUIRED identify this correction's conformance requirements.
Implementation-defined behavior MUST remain bound by a future exact compound seal.
Source implementation and static checks are not dynamic conformance evidence.

## Problem Statement

The inspected baseline is composition
`b1b8566686769e5e53433048f2058ab09d8c00c3`. Frozen FC-F02 at `cbf906a3` identifies
uncharged parent metadata. Frozen FC-F03 at `a3c3e658` identifies an outgoing
deadline erased by a phase-index change. INPUTS.json binds their complete bytes
and source excerpts. Both original findings remain unchanged.

## Goals and Non-Goals

This component MUST correct those two source defects only. It MUST NOT edit
worker-api, the FC-F01 tool-request helper, product code, the old build component,
the parent composition or another leaf's files. It MUST NOT grant RootGO, invoke
the proposed executor or add cohort slots. No capture, clock, budget-class,
proxy/getter, compiler, loader, candidate or synthetic control is run here.

## Boundary and Roles

The supervisor owns the per-job capture balance; the process owner and phase
recorder share it. The worker's existing EVIDENCE_RESERVE protocol and the existing
build-adoption debit remain in force. No worker API or IPC schema changes.

The per-job capture domain is every retained regular file below that job's
`request.evidenceRoot`, not selected extensions or selected writers. Request JSON,
phase NDJSON, every process's stdout/stderr and process JSON, worker publications,
projection subdirectories, copied pristine captures, build tar/gzip evidence,
parent adoption, job receipt, integrity failure, outcome and new budget/deadline
records MUST all count. Repeated bytes at distinct paths MUST count again.
An unexpected file has no zero-byte exemption; the final snapshot counts it and
its regular kind/mode/hash/membership remains guarded. This accounting is not a
new filename allowlist or hostile-host sandbox.

The separate `work/<ordinal>` tree retains filesystem-role inputs and outputs:
authenticated source/archive/package materializations, compiler config/raw output,
new compiled package, type fixtures, installed/moved variants and owned control
fixtures. CMD22's scratch `raw-fixture.json` and counterfactual predicate output
are control-work files, not real candidate stdout or a substituted job receipt.
These exact inherited roles are inventoried in EVIDENCE-ROLES.json. They stay
under the existing work-tree limits and whole-tree guards and count toward the
unchanged global logical disk accounting; this correction moves no artifact there.

Coordinator boot, coordinator summary, coverage and supervisor-final are cohort
records at the root, not per-job files. The shared process owner's coordinator
process metadata now debits its existing 16MiB capture balance as well; this does
not create a second job allowance or raise that balance.

## One 32MiB Balance

For every job, the supervisor MUST create the balance before writing request.json.
The exact cap remains 33554432 bytes. It MUST reserve 4194304 bytes for phase data
and the following 933888 bytes for named terminal uses inside that same cap:

| Reserved role | Bytes |
| --- | ---: |
| Outer process receipt | 131072 |
| Job receipt | 262144 |
| Integrity failure | 131072 |
| Outer outcome | 262144 |
| Accounting record | 65536 |
| Capture overflow record | 65536 |
| Phase deadline record | 16384 |

The initial ordinary balance is therefore 28426240 bytes, before request bytes.
This is reserved terminal space, not extra capacity. Ordinary bytes, raw prefixes,
worker reservations and build adoption MUST debit the shared ordinary balance
before writing. Phase bytes MUST debit the reserved phase portion before append.
Every terminal publication MUST debit its named reservation before writing.

Each tool or coordinator process MUST reserve 131072 ordinary bytes for its
process receipt before opening streams or spawning. One owner still has at most
one tool in flight. After publication only unused reservation bytes return to
the same ordinary balance; used bytes never return. This is settlement of a
known reservation, not deadline renewal or a fresh capture allowance. Outer
process metadata uses its protected terminal slot instead.

If a metadata record exceeds its guaranteed slot but fits the unchanged 16MiB
file limit and the remaining ordinary balance, the writer MUST charge the exact
additional ordinary bytes before publishing the complete original serialization.
It MUST NOT borrow another terminal slot or the phase reserve. If it cannot fit,
it MUST retain a bounded failure record with original serialized byte length,
SHA-256 and at most 1024 original bytes represented as hex. It MUST report
incomplete metadata and sticky overflow, not a successful original receipt.
No retry or content deduplication is permitted.

Raw stdout/stderr MUST retain the admitted prefix exactly. The shared balance
MUST be charged before writes, including partial-write handling. Additional
unadmitted bytes cause overflow FAIL, while the terminal reserve remains available
for truthful failure evidence. File I/O failures remain failures; reserved logical
space does not guarantee a writable disk or successful fsync.

## Closure and Adoption

After all owned processes settle and phase capture closes, the supervisor MUST
compare the complete actual evidence-tree byte total with both 33554432 and the
charged/reserved accounting upper bound. It MUST repeat that actual check after
accounting and outer-outcome files have been written. No later job metadata write
is permitted after that final snapshot. The final parent row carries that actual
total and artifact references; the earlier outcome expressly has a pending final
capture check. A failed final check overrides any earlier worker PASS.

The evidence snapshot's tree limit MUST be 33554432, not the old 268435456 work
limit. Work-tree limits remain separate and unchanged. All closed evidence and
work trees retain their byte/mode/membership guards, including new entries.
Unknown or uncharged evidence is a failed closure, not permission to remove,
reclassify or deduplicate it. No successful closure is claimed after I/O failure,
unknown reap, unexpected nonzero status or unsafe admission.

## Outgoing Deadline Before Transition

The phase recorder MUST sample parent monotonic time and obtain the outgoing
deadline before changing its phase index. The outgoing deadline is the minimum
of global, phase, slot and work deadlines, further limited by the fixed setup or
operation cap. Source setup remains 5s, moved/loaded setup remains 40s and actual
semantic operation remains 30s. Existing non-semantic slot limits are unchanged.

An observation at or after the outgoing deadline MUST fail. The recorder MUST
retain the first late observation, requested transition, outgoing index/deadline,
fixed absolute deadlines and checkpoint in protected terminal evidence. It MUST
also retain the ordinary bounded phase event when its existing quota permits.
The late index MUST NOT advance and its deadline MUST remain sticky.

The recorder MUST check again immediately before assigning the next index, after
phase serialization/append/fsync. Thus a timely entry observation followed by
late synchronous capture cannot erase the expired deadline. The initial parent
record observation remains the conservative operation-start timestamp; no later
worker-supplied time or capture cost extends the operation cap. A post-append
failure identifies the second observation in phase-deadline.json beside the
original phase event.

Repeated late calls MUST retain the first failure and throw the same cached
deadline error. The supervisor MUST terminate the owned process as timed out and
retain a failed result even if a later monitor poll would otherwise miss the
boundary. Timeout is sticky even if termination already began for another reason.
The 10ms monitor interval is unchanged and is not the fix or a timing guarantee.

## Preserved Guarantees and Limits

The correction MUST preserve original thrown errors on synchronous spawn failure,
raw-before-classification, known-reap checks, nonzero/timeout overrides and unsafe
admission stops. It MUST NOT alter semantic rejection identity, public YQ caps,
CARRY, loaded proof roles or the independent build recipe.

Budgets remain 336 outer slots, at most 18 compiler descendants, 24165000ms global,
16MiB worker streams, 8MiB compiler streams, 4MiB/4096 phase events, 262144-byte IPC,
32MiB per-job capture and 24GiB global logical disk. Cleanup stays inside existing
absolute deadlines. No hard RSS, physical quota, scheduling precision, hostile
host-JavaScript isolation or opaque-work preemption is promised. Atomic publication
temporarily uses the unchanged pending/link protocol; the quota describes admitted
retained logical bytes, not an OS-enforced storage transaction.

## Test and Validation Matrix

| Requirement | Static evidence now | Future evidence required |
| --- | --- | --- |
| All parent/tool writes charged | Writer inventory and source diff | Near-cap publication controls |
| Prefix and terminal capture | Exact reservation/data witnesses | Saturation and metadata overflow |
| Final actual total | Two closing checks and strict snapshot | Extra/duplicate/unaccounted file controls |
| Outgoing deadline retained | Both checks precede index assignment | Entry/equality/post-append boundaries |
| Sticky failure and reap | Parent/process propagation source | Late event followed by normal close |
| No cross-scope changes | Exact Git preimages and assembly overlay | Root's fresh compound review |

DEFERRED-WITNESSES.json supplies exact data, expected outcomes and UNRUN status.
Syntax checks, specification lint and immutable-source hashing are the only
validation performed here. They do not pass any deferred control.

## Conformance Criteria

This source seal is ready for independent static review, not execution acceptance.
Root MUST combine this disjoint overlay with FC-F01 under a new exact assembly
seal; this worker does not recompose the recipe. A fresh separately authorized
RootGO and dynamic evidence remain REQUIRED for actual conformance. Original b1,
all failed captures/seals and the sealed 937c1f6a build component remain unchanged.
