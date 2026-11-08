# Frozen Node repair review v2

2026-08-29. **SOURCE/DATA ONLY; not acceptance.** Reviewed only
c10d338331d56e1f293970010c7015fa602b6a8d, with author policy/preseal
ee150ba1d2c9165118310d78de8d6453020b9271. No inspection of concurrent fixes.
Sixteen Node source/doc blobs (137593 bytes) match every body/hash in MODULE-v4.
The compressed SOURCE-DATA archive is data, not an executable source checkout.

## Actionable findings sent to ROOT/Locke during review

### V2-F01 — definite delimiter defect, compiler not run

`src/commands/node/rules.ts:1` ends `String.raw` followed by byte92 then byte96.
Line133 similarly starts byte92 then byte96. These are literal backslashes before
the opening/closing template delimiters, not tool escaping: the captured first
48 source bytes prove this. The opening backslash is not valid TypeScript token
syntax. `program.ts:4` imports this file, and `index.ts:7` imports program.
This source cannot be admitted to the proposed build unchanged. No compiler or
target parser was run; no exact diagnostic code is invented. Check the ongoing
author correction rather than altering the frozen input or calling it tested.

### V2-F02 — private profile cancellation does not cancel parent work

The old F01 escaping-error path is repaired, but a distinct reference path remains:

1. `worker-provider.ts:121` awaits an admitted `services.request`. Its VFS read
   receives the NodeOwner private signal (`host.ts:182`).
2. While that cooperative read is pending, the owned native diagnostic channel
   can exceed its cap (`worker-provider.ts:67–70`). Its handler invokes
   `#protocolFailure` at line54, which resolves a profileFailure completion and
   cancels/stops the Worker, **without notifying/aborting NodeOwner parent work**.
3. `lifecycle.ts:88–90` accepts that completion without private cancellation.
   `index.ts:103–114` diagnoses/cuts off/closes; `close` aborts only when it already
   has a primary reason (`lifecycle.ts:128–130`). This branch has none.
4. Reference retirement awaits `#chain` (`worker-provider.ts:209`), which can still
   be waiting on that cooperative read. The admission timer is closed; no later
   deadline necessarily rescues it. Worker exit alone is insufficient.

A simpler synthetic prepared session can expose the same NodeOwner seam: admit a
cooperative read, return explicit profileFailure, then prove-no-acquisition retire.
That is NOT actual Worker/native-channel proof. The native diagnostic event
ordering scenario is SOURCE reasoning, not a reproduced runtime trace.

API-v3:11 explicitly requires **fatal execution OR profile cancellation** to abort
invocation-private parent work; normal entry-return instead drains without abort.
Preserve this distinction and Q01: do not turn internal profile completion into
an escaping start rejection merely to deliver cancellation. A Node-local explicit
profile-completion cancellation path is sufficient in principle; no new shared
Shell field, root abort, forced opaque cleanup or status reclassification requested.

### V2-Q02 — asynchronous reference observer is a separate open interface seam

The repaired `publishNodeObservation` now awaits a native Promise and returns
explicit fault presence, including undefined (`diagnostics.ts:26–35`). Its Worker
caller awaits it (`worker-main.ts:86–89`). This closes the original helper defect
at SOURCE level, not dynamically.

The new public-local `NodeWorkerProviderOptions.observe` still returns `void`
(`worker-types.ts:24`), and `WorkerSession.#event` ignores its return (`:44–46`).
An async observer is assignable to a void-returning callback; its later rejection
is not owned by that synchronous try/catch. No reviewed documentation explicitly
excludes async observers. This is not proof that the author uses an async publisher,
nor a claim the fixed helper is broken. ROOT/author should specify whether observe
is a synchronous-only notification boundary with checked completion, or whether
asynchronous publication is supported and enrolled/joined. Do not infer completion
from the void annotation. Keep actual parent raw failure and serialized Worker
diagnostics separate. No runtime unhandled-rejection test was run.

## Prior findings and root decisions

| Prior item | Frozen source assessment |
| --- | --- |
| F01 escaping execution | `start` catch calls failure(execution); failure aborts private signal before cancel, and close also aborts a selected primary. Repaired SOURCE path; V2-F02 is distinct. |
| F02 FS-shaped lookalike | `host.ts:11–30` rejects proxies, bounds prototype walk, calls accepted isFsError, then reads finite own-data selected fields. Repaired SOURCE path. |
| F03 early diagnostic | `index.ts:40–48` creates an inert diagnostic host for granted early stderr, without source/provider/input acquisition. Repaired SOURCE path. |
| Q01 provenance | start rejection is execution; explicit profileFailure remains a completion; `services.fail` and reference `#escaping` retain an escaping reason separately from local `#primary`, including undefined. No class/equality inference is used for that handoff. |
| Q02 helper | Native-Promise/undefined completion checked and awaited; returned fault presence retained. Real observer seam above remains separate. |
| Q03 cause/stack | Genuine typed recognition precedes extraction; only stack/cause are skipped without reading their values; selected accessors/unrelated extras refuse. Raw FS reference remains until postcopy/retire. |

The source-only verdict does not convert any original finding into a runtime pass.

## Enforced versus trusted

Command-owned: exact CLI/source admission; finite seven boolean grants across the
supplied VFS namespace; virtual path resolution; genuine FS-route DTO selection;
raw parent reasons; serial request/postcopy credit; shared Shell sinks/budgets;
registered cleanup before prepare/start; private deadline/cancellation; finite
source/operation/output/ledger checks. Readonly enforcement remains the VFS's
actual EROFS, not a grant override. JSON requires dataRead+jsonModules and fresh
realpath authorization, including cache hits. A pathname check is not a race lease
or proof of disjoint backing; whole-namespace grants are not per-path grants.

Reference-owned: fixed worker-main entry; explicit host-supplied canonical file URL
and adapter identity/ABI; empty native Worker env/argv; native output drains, fixed
197056-byte SAB, 64KiB serial frames, bounded sequence/phase/offset checks and
precharged upload/result copies. Credit follows metadata admission; FINAL_ACK is
not guest delivery. Parent response/FS-reference retirement follows the separate
postcopy witness. Cancellation sets the shared stop flag/wakes sync wait and
requests termination. Retirement requires actual exit, native channel cleanup,
message chain and command-owned parent jobs. Unknown acquisition or cleanup is
not reported clean; intentional fail-closed retention is not mislabeled a leak.

Provider-trusted: inert prepare; actual cleanup/retirement receipts for an arbitrary
injected provider; authorized adapter code and its static import closure; engine
isolation, primitive bridge injection and step/call enforcement. The new lowerer
and interpreted rules are real source enforcement, not yet executed containment
proof. A malicious host callback is not sandboxed. `entry`/`identity` are explicit
host authorization, not cryptographic authentication supplied by the command.

The shipping Node module does not vendor/import PUBLIC95 automatically. The
author test adapter alone imports `engine/dist/core.js` and passes a synchronous
bridge with a separate guest Budget; this must not reset the enclosing Shell
budget. Actual test-engine closure/load receipts remain future activation inputs.

16MiB is a named command ledger, not all guest allocations or RSS. 197056 SAB and
V8 old32/young8/code8/stack4MiB limits are separately scoped. Five seconds bounds
admission, not cleanup/completion. Several simultaneous reservations make individual
maxima unreachable together. Lifetime entry-return cutoff may abandon implicit
guest continuations and is not Q/all-jobs-settled. No native Node parity claim.

## Preparation/readiness

`candidate-binding-preparation` binds all original38 semantic/8 type/6 load
families without changing their original descriptions. It adds selected exact raw
controls as **unexecuted .mjs.data**, not a fake Worker or engine pass. The data-only
dispatcher has no activation/import branch. Complete future expanded runtime
counts, compiled package/hash/load identities and actual-run authority still need
a final candidate-specific seal; the source concern is not bypassed to start it.

Author v1 899658's missing owned-output READ permission stop remains a harness
admission result with0 Workers/guests, not a product finding. Concurrent author
v2 results are deliberately outside this review. Public79 derived identity and
the prior accepted898 archive remain inherited, not rebuilt/retested here.
