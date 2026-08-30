# Different Worker v3 source review — 2026-08-28

**SOURCE/DATA ONLY. No compiler, Worker, engine, subject import or native Node
observation. Concrete source candidate remains HOLD.** This does not revoke the
ratified D1–D3 policy or confuse missing public inputs with a runtime failure.

Subject: `f9bf774409eca40b0518b322db6fcb652cd6cd7f`.
Author DATA evidence: `10f49933f430dccfd828dce1c5339ab8b2851458`.
Different preseal: `871c92df`.

Design seal SHA-256:
`7a89d5911ddadcd7154c84553ce35442e744f2ded14d484af2b4e1bc92fcdacd`.
Preparation seal SHA-256:
`12f754bcb5cbd68bc4fbd7e187a2d529a20769d61b355fd74c3693f50c7d38a9`.

All abbreviated source references below refer to the frozen
`tests/commands/node-worker-experiments-20260828/preparation-v1/` subtree, not a
subsequent author repair. Full source Git blob/SHA-256 inventory is in
`DATA-RESULT.json`. No author files or apply_patch files were edited.

## Decision and scope

The four requested **design corrections** are present and consistent with the
previous review's recommendations. The optional own-undefined rule is narrow;
metadata-only FINAL_ACK is explicit; control/cache schemas are finite; unknown
acquisition is not falsely called exit. The source takes useful steps toward
the design but **does not yet implement all its ownership/error obligations**.

Priority concrete findings: **S2 terminal-only error reconciliation**,
**S3 cleanup failure being acknowledged as closed/FREE**, and **S6 sink errors
entering the typed-FS conversion route**. S1 gives exact source
mechanisms behind the author's already-disclosed K3 HOLD; S4/S5 identify narrower
validation/accounting differences beyond missing runtime evidence. These are
source-derived paths, not executed failures or claims that all nine fixed
positive fixture branches fail. Send these to Locke while public closure/L02/L08
preparation proceeds; do not execute the currently incomplete public entry.

## R1–R4 correction review

| Item | Frozen design/source finding | Qualification |
| --- | --- | --- |
| R1 / F7 own-undefined | `errors.mjs:5` requires a supplied typed-origin recognizer. Own descriptors are inspected; only optional path/syscall/dest absent or own-undefined map to null. Present strings including empty survive; getters/extras/null/wrong optional types refuse. Required fields remain strict; guest code omits null optional fields. | Correct narrow source representation adaptation. All28 vocabulary names match the design and unchanged previously reviewed contract binding. No actual compiled FsError/constructor/provider run; supervisor still supplies no typed recognizer. |
| R2 zero-result FINAL_ACK | `sync-bridge.mjs:61` has the empty-result branch with exact result tag/zero length/offset; parent validates matching totals and tag at `parent-rpc.mjs:110`. No payload clearing or synthetic data frame. | Ordinary zero-result edge implemented in source. Cleanup-success semantics still have S3. No live zero-read/write/error transfer observed. |
| R3 controls/cache | `wire.mjs:32` fixes READY/doorbell/terminal ordered keys, version3 and scalar bounds; `cacheHandle:54` fixes namespace1..128/path. Terminal carries deliveredSeq; this is not an ACK-as-delivery rule. | Schema ambiguity resolved. S4 concerns validation order and malformed frames, not a request to broaden schemas. |
| R4 nonacquisition | `owner.mjs:63` distinguishes not-attempted/proven-none/constructing/acquired/unconfirmed. Construction throw remains unconfirmed; `close:86` waits for actual exit unless proven-none, then awaits registered cleanup. | Correct conservative policy; no constructor/nonacquisition/late-handle execution. Proven-none supervisor return shape/outer admission still needs a bound control before claiming that path works end-to-end. |

The design preserves all28 FS codes, eight WRQ identities, L retirement rather
than Q/all-jobs-settled, explicit undefined caller presence, caller/control/raw
failure provenance, 5s admission rather than completion, and independent actual
Worker exit plus parent cleanup. No new public API/policy choice is necessary to
repair the concrete source paths below.

## S1 — K3 release is earlier than retained ownership, concretely

`parent-rpc.mjs:82` reserves12MiB for an operation. The closure registered at87
captures `staged`, which contains upload and resultBytes. `finishEffect:23` adds
another cleanup closure capturing the same active record. `owner.mjs:28` retains
each record in its cleanup array even after its completion Promise settles.
FINAL_ACK at121 closes/releases the reservation and sets `current=null`, but does
not clear the retained byte fields or unregister/clear these closures.

Thus even **after** later postcopy, the old parent byte arrays remain reachable
while the ledger can credit another12MiB reservation. This is more concrete than
an unmeasured GC/engine-journal lifetime: there are direct retained references in
the parent source. It is consistent with the author's K3 HOLD, not an already
accepted weaker16MiB accounting profile.

Other exact admission issues to fix in the same ownership reasoning:

- Reservation82 precedes authorize83 and upload allocation84; the rollback
  cleanup is not registered until87. If either intervening operation throws,
  no reservation owner was enrolled. The fixed authorize helper currently does
  not throw, so this is an initialization-failure path, not a claimed failed case.
- `sync-bridge.mjs:72` JSON-stringifies the entire primitive result envelope
  after parent FREE/release. A1MiB NUL-text result alone expands to6MiB of escape
  text before wrapper overhead. This is deterministic serialization arithmetic,
  not a measured allocation peak. That copy and engine copy/journal lifetime
  need explicit reservation; a flat pool released at ACK does not establish it.
- `send(...,encode(metadata))` computes metadata string/Buffer before
  `publish:146` allocates its frame number. This differs from the stated
  frame-admission-before-encoding rule, although each metadata body remains
  bounded and the parent has a coarse scratch reservation. Do not confuse
  bounded scratch with a demonstrated frame/precharge contract.

Smallest repair direction: enroll rollback before fallible staging acquisition;
give each retained byte/string/record an explicit owner and release point; drop
references when that lifetime actually ends, retaining credit otherwise. Reserve
the result-envelope expansion and copied/journaled lifetime before creation.
No blanket retain12MiB per operation until exit (that would block ordinary second
operations), no fabricated GC signal, ACK-based release, raised limit or RSS claim.
Actual public bridge/clone accounting remains K3 even after parent references are
fixed; a bounded static fixture proof is not arbitrary-user-source proof.

## S2 — Undelivered typed failures reconcile only on terminal

`finishEffect:50` stores an authenticated typed original in `outcomes` and sends
the DTO. `terminal:132` is the **only** path that promotes a missing delivery
witness to `owner.fail(original,'undelivered-parent')`. Final cleanup/exit in
`supervisor.mjs:79` does not invoke equivalent reconciliation.

Concrete source trace, **not executed**:

1. A future real typed-origin L02 operation rejects; its original is stored.
2. Transport FINAL_ACK/FREE occurs, but no authenticated terminal delivery count
   reaches the parent (e.g. admission deadline between FREE and marker/terminal).
3. The parent's private-profile deadline stops/terminates the Worker. Actual
   exit occurs; cleanup is awaited. No `rpc.terminal()` runs.
4. `supervisor:86` builds raw only from owner.failures; the original is still
   merely in rpc.outcomes. With only private-profile failures, status becomes2.
   Receipt outcomes omit the original reference; raw does not contain it.

This contradicts the design's requirement that cancellation/interrupted terminal
leaves delivery unknown **and preserves the typed original as an escaping parent
failure**. It is not an assertion that current L02 ran: typedOrigin is currently
null and that instance is explicitly incomplete.

Repair: reconcile the outcome ledger on **every final settlement path**, using
only authenticated postcopy evidence. Unknown remains undelivered; retain actual
original identity/provenance before final raw/numeric selection. Do not elevate
an already delivered/caught FS error, infer delivery from ACK/exit, or override
root caller/control priority. Freeze a missing-terminal/post-ACK interruption
control as well as the normal caught-error positive before actual L02 admission.

## S3 — Operation cleanup rejection can still publish FREE

The close function returned by `owner.registerCleanup:32` records a cleanup
rejection but **resolves** its completion. `parent-rpc:121` awaits that wrapper,
then unconditionally marks outcome.closed=true and publishes FREE at127.
The actual operation close at25 can have thrown before active.closed or its
reservation release. Therefore FREE/closed are not evidence of successful
operation cleanup. For ordinary successful operations the same source edge is fine.

This does **not** claim that the final raw cleanup error is always lost: owner
retains it, and supervisor's final raw list normally makes status null. The defect
is the earlier success-like cleanup/transport publication and continued OPEN
admission, not a demonstrated final numeric-success case. A later reservation
failure may happen to stop service; that is not cleanup correctness.

Repair: distinguish cleanup settlement from successful closure. Preserve the
raw cleanup error, stop admission on this path, and do not publish ordinary FREE
or set a success-like closed fact after rejection. Keep root drain idempotent and
await all owners without dropping the actual reason. An operation-close rejection
after a successful effect is the minimum targeted source/control case; it differs
from the existing L06b invocation-level cleanup rejection after a failed sink.

## S4 — Exact-role/receiver validation has narrow source gaps

- `wire.control:39` JSON-stringifies values before all scalar kind/sequence/frame
  validations. `response:113` uses record.kind as a property key before requiring
  its primitive string role. Exact own keys alone do not validate their values;
  malformed nested values can trigger coercion/serialization before refusal.
  Require exact primitive values/ranges first, then bounded canonical encoding.
  This is a validator-contract issue, not a hostile-host-JS sandbox claim or a
  demonstrated guest-to-port exploit. Structured-clone transport narrows possible
  accessors but does not replace the declared own-data validator obligation.
- `acquire:171` copies payload before callers validate phase/tag/phase-specific
  length. The raw copy has a64KiB cap, but HEADER/META require8KiB and some phases
  require zero. Separate validated header acquisition from bounded payload copy,
  or validate the relevant phase envelope before copying it.
- At upload completion `parent-rpc:104` charges and starts the effect without the
  design's final whole-upload UTF8 validation. A correctly framed one-byte FF
  upload would reach fixture.start/write; the normal trusted string encoder
  cannot generate it. This is a malformed-peer/protocol-control source path,
  **not** an observed failure of one of the nine literal guest branches. Validate
  the complete staged encoding before effect admission, without exposing new
  guest capabilities or changing normal UTF8 replacement policy implicitly.

The existing good guards are meaningful: single active slot, CAS ownership,
sequence and predecessor checks, exact credited lengths/offsets, complete upload
before effect enrollment, per-operation1MiB and finite cumulative counters,
reserved/inactive-byte checks and permanent stop/wake checks. Do not replace
these with a broad rewrite or call a malformed-header rejection a live race pass.

## S5 — JSON-cache input cap counts UTF-16 units, not input bytes

`scaffold.guest.js.data:142` checks `jsonUnits + read.text.length <=1048576`.
The design's CACHE ledger is **1MiB cumulative JSON input bytes**; parent read
accounting allows4MiB and does not separately apply the JSON-input limit.

Example source arithmetic: two JSON strings each containing200000 literal `猫`
characters have600002 UTF8 bytes each but200002 UTF-16 units each. Both per-read
limits and the scaffold's400004-unit sum permit them; cumulative JSON input is
1200004 bytes, greater than1048576. No such new guest was executed or admitted.
The fixed L03 ASCII fixture does not demonstrate this boundary.

Repair using truthful already-known parent byte counts/authority or a correctly
bounded guest UTF8 counter, charged before cache installation; do not silently
relabel the approved byte cap as units. Preserve per-require reauthorization,
namespace/path recheck, same guest root on canonical hits, no write invalidation,
no failed-parse insertion, no eviction/refund and actual exit retirement. Handle1
for this sole development Map is an invocation routing label, not fabricated
FileStat identity or arbitrary cross-provider disjointness.

## S6 — Typed class recognition does not establish FS operation provenance

`parent-rpc.mjs:46` handles failures of every operation, including writeOutput.
When a supplied typedOrigin recognizer exists, line48 tries it for all these
failures. There is no operation-route check before constructing a guest FsError
DTO. The recognizer receives only the thrown value, not the operation.

Concrete source trace, **not executed**: enable legitimate isFsError for the
future L02 provider; a writeOutput sink throws an actual FsError object (for
example, a sink backed by a file). Recognition succeeds, the parent encodes an
ordinary fsError result, the guest can catch it, and a normal delivery marker/
terminal prevents promotion to an escaping parent failure. The final ordinary
guest result can therefore hide what the design calls an actual raw sink failure.
This is not merely a lookalike code object or a hostile callback assumption.

The current fixture's sink reason is a distinct plain object and typedOrigin is
null, so current L06b does not exercise this path. Fix it before enabling L02:
gate ordinary typed-FS conversion on the actual enrolled FS operation provenance;
writeOutput/caller/control/cleanup errors must retain their raw route regardless
of class or code. Do not broaden this into a new public brand/API or infer routes
from reason equality. A genuine FsError sink rejection paired with a genuine
missing-file catchable positive is the minimum control distinction.

## K1/K2 and remaining scope

The fixed scaffold keeps module/JSON objects inside one interpreted invocation;
fs/node:fs return the same local record and JSON hits return the cached root after
parent reauthorization. The returned primitive envelope is not cache identity.
The selected guest shadows the raw bridge parameter; no SAB/port/native fs/process
is intentionally returned. These are source properties, not containment proof
against arbitrary source or all public interpreter intrinsics.

K1 is honestly still blocked for arbitrary options: option():85 uses Object.keys
and direct value.encoding/value.flag reads, not original own-data descriptor
validation. Fixed authored data literals can justify only those literal cases;
they do not cover getters, nonenumerable/symbol extras or arbitrary proxies. The
missing public descriptor facilities are not solved by validating a copied host
object. Keep full NP1 selectors/options/wx obligations unqualified rather than
redefining the product to fixed literals.

K2 improves materially: the guest wrapper parses the returned primitive string,
constructs Error and fields, then issues the contiguous hidden marker before
throwing/returning. Transport ACK/FREE alone is not reported as delivery. Actual
ordinary bridge/catch/field/journal behavior remains unrun, S2 must be fixed, and
terminal lost after an actual marker still leaves parent evidence unknown. The
existing Shell priority and typed VFS routes remain absent from this Map-only
supervisor; returned raw records are not a demonstrated public command mapping.

R4's conservative unconfirmed-constructor path can remain unsettled; do not turn
an observer timeout into clean settlement. The proven-none branch currently
returns bare owner facts in supervisor's early return while parent-entry expects
{receipt,raw} and requires facts.exited. This is an unexercised integration seam,
not proof the nine admitted-after-construction branches fail. Bind its explicit
receipt/control before claiming preacquisition coverage.

## Eight WRQ mappings and next prerequisites

| Identity | Frozen instances | Source-only status |
| --- | ---: | --- |
| WRQ01/L01 |1 Worker/1 guest| synchronous text/read-edit-wx-output candidate; no actual reaction/bridge observation |
| WRQ02/L02 |1/1| incomplete typed provider; optional fields/28-code controls unrun |
| WRQ03/L03 |1/1| local alias/root candidate; changed/unknown authority and cache limits unrun |
| WRQ04/L04 |1/1| discarded Promise plus retirement; no Q/all-settled assertion |
| WRQ05/L05 |3/3| explicit undefined/false/object caller records; other upload/ownership barriers unrun |
| WRQ06/L06 |2/2| completed effect then cancel/cleanup, and sink plus invocation cleanup failure; not simultaneous guest async IO |
| WRQ07/L07 |1/1| computed refusal/denied write/bridge shadow candidate; not arbitrary containment proof |
| WRQ08/L08 |1 Worker/0 guests| incomplete heap/resource/exit control; do not count its static branch as a pass |

Total ceilings remain11 Workers/10 guests; nine concrete source instances, zero
admitted/zero evaluated/zero semantic passes. No extra Worker/guest slots requested.
Locke is already assigned public closure/emission preparation and L02/L08; this
review neither fetched additional sources nor duplicated that work.

Before actual WRQ GO: repair/review S1–S6, complete the independently bound public
entry/tool/emission closure, and seal exact launch/load/capture/reap/source limits.
Add focused control predicates for interrupted typed delivery, per-operation
cleanup rejection, typed FsError on a non-FS sink route, released-credit retained buffers, initialization rollback,
UTF8 cache bytes, invalid upload/header and scalar-before-serialization. These
are **future control requirements**, not executions here or permission to expand
the11/10 ceiling. Parent error/Shell mapping and K1/K3 obligations cannot be marked
done by passing the fixed nine guest bodies. ROOT must separately authorize any
model/compiler/Worker/engine phase; input availability alone is not GO.

## Actual DATA and cleanup

One sealed checker authenticated exact NUL-delimited38 subject files, both
ROOT-supplied seals and their declared body/external hashes, and48 pinned input
records with Git blob/SHA-256/byte-length checks. All38 inspected local bodies
matched the frozen subject at inspection; a final read-only Git diff showed no
subject-source changes (later author evidence directory excluded).

Three read-only Git children plus the DATA checker, peak two including parent;
all three exited0 naturally. Captured1249506 bytes; logical work1494005 bytes;
elapsed127ms (metadata observation, not performance result). No temporary roots,
no active owned child, no source materialization, no subject/harness imports,
compiler/Worker/engine/private/network execution. No DATA-check failure or retry.
No public66/core/lint execution was attempted. Original v1/v2 reviews, all held
NP1/F05/ABI8/native profiles and apply_patch753f33d2 stay unchanged.
