# Worker resource/quiescence correction v3

Status: Proposed; ROOT authorized correction/source preparation, not execution.

Implemented Through: Not applicable. No provider/product implementation accepted.

Purpose: Correct R1–R4 without reopening D1–D3 and bind a concrete, held source checkpoint.

## Authority, goals and non-goals

The governing review is committed `7b7a54ef5f1710d78297402a531a1fed63266cca`,
`tests/commands/node-worker-independent-20260828/v2/REPORT.md` and
`MINIMUM-EXPERIMENT-PRESEAL.md`. v2 remains immutable at
`82aae2f5bff404423e81ddb6ddfacb6e0abd35a9`; its ROOT-RATIFICATION, CONTRACT,
CACHE and unchanged portions of RPC/CAPS/ERRORS remain the normative proposal
basis. This v3 is an append-only correction, not a second accepted product spec.
The explicit correction here wins over incompatible v2 wording, especially R1.

D1 is the separately selected L-entry-return synchronous text-I/O slice:
`.cjs`, eval, primitive print, stdin source, JSON editing and explicit VFS grants.
Promise-fs/fs.promises, process.exit, npm/npx/package search, `.js`, ESM and TLA
remain excluded. Ordinary allowed language Promise continuations MAY be abandoned;
entry return/Worker exit MUST NOT be called Q, all-jobs-settled or NP1 completion.
An optional injected qualifying provider has zero core runtime dependencies.
Native eval/Function/subprocess fallback and private imports/brands are forbidden.

Only one finite static interpreted fixture body is supplied. The full D1 grammar,
all CLI selectors, arbitrary options objects and full Node compatibility remain
unqualified. No additional product module, package/export or default command.

## Actors and ownership

The parent owns the VFS, sink, admission gate, acquisition receipt, job ledger,
raw failure values, one fixed SAB, capture and cleanup. The trusted Worker owns
its endpoint scratch and one public `run(source,{bindings,...})` invocation.
The ordinary injected bridge is non-async and accepts six finite primitive
arguments; it blocks with Atomics.wait while the parent performs cooperative
VFS work. The guest receives only interpreted facades and synthetic process data,
never Worker/SAB/ports/native fs/native process. Module/JSON roots live inside
that interpreted invocation, not as reused host records crossing fresh copy maps.

The new experiment files are source candidates, not conformance evidence. The
development Map fixture is explicitly NOT the product FileSystem contract.
Actual Shell/raw priority integration and actual typed FsError provider are held.

## R1: optional typed source fields

On a trusted typed-origin FsError extraction route, and ONLY there, an absent
own descriptor OR an own data descriptor whose value is undefined for `path`,
`syscall`, `dest` MUST encode null, then omit that optional guest property.
Actual own strings, including empty strings, MUST be preserved. Required fields,
all28 codes and finite numeric errno retain strict validation. Declared diagnostic
fields may not smuggle arbitrary fields or getters. No shape-only error authority,
prototype-equality DTO gate, coercion or general undefined relaxation is allowed.
Wire/control/cache/options never accept undefined. Parent originals remain held
by reference independently from the DTO and guest-created Error.

The compiled class-field representation is a source/profile inference from the
review, NOT a compiler/constructor observation. Actual FsError compilation and
its own-undefined controls are not selected or run in this preparation.

## R2: metadata-only FINAL_ACK

RPC.json adds the explicit `RESPONSE/RESULT_META -> WORKER_OWNED -> ACK/FINAL_ACK`
edge for empty TEXT, VOID, FS_ERROR, UNSUPPORTED and DENIED. After successful
metadata validation: total=offset=0, exact matching result tag, payloadLength=0,
same session/sequence and correct predecessor. The Worker precharges/reserves a
frame, checks stop and owns state1 before writing header words1–8 and CAS1->5.
It MUST NOT rewrite or zero payload bytes, reserved words, inactive slots or
parent-owned state. The parent CAS5->3, validates, and only publishes FREE3->0
after actual operation settlement and independent cooperative cleanup. No ACK,
FREE, zero payload, terminal or clean exit by itself witnesses bridge delivery.
Stop/wake uses global words0/1; it never steals payload ownership.

## R3: exact controls and cache authority

Version3 uses the finite own-data schemas in RPC.json: READY, doorbell, terminal
and cache handle. All keys, order, scalar ranges, byte bounds and lifetime rules
are fixed. No holes, symbols, getters, extras, inherited properties, nonfinite
numbers, -0 or coercion. Sender and receiver MUST validate. Namespace is an
invocation-local positive integer1..128 bound by the parent to actual backing
authority; it is NOT FileStat.identityScope or proof of disjoint storage.
Read completion MUST recheck the exact namespace/path authorized before a miss;
unknown/changed authority refuses installation. Cache hits reauthorize, retain
the same guest object, and writes do not invalidate it. Failed parse installs no
root. No cache quota reset/eviction is permitted to manufacture capacity.

The source candidate adds `deliveredSeq` to the existing terminal, not a new
control message or RPC operation. Its trusted interpreted wrapper receives and
parses the returned primitive string and constructs an Error before issuing a
hidden postcopy primitive marker. The Worker records strictly contiguous markers
and later reports that count. A marker is not inferred from callback entry, ACK,
wrapper count or terminal order. This is a concrete K2 candidate awaiting source
review and actual catch/field evidence; interrupted or absent markers leave
delivery unknown. The two ordinary callbacks per operation still consume the
same engine budget; no private host-call hooks or budget reset are used.

## R4: acquisition is not exit

Ownership cleanup MUST enroll synchronously before any acquisition attempt.
Receipt states are `not-attempted`, `proven-none`, `constructing`, `acquired`,
`unconfirmed`. Preflight/pre-abort with no attempted Worker constructor may prove
none; it MUST close other admitted owners but MUST NOT wait for or fabricate an
exit. A constructor throw proves none only if a separately bound actual API
guarantees no acquired/pending Worker. The source checkpoint has no such proof:
its constructor throw is conservatively unconfirmed and cannot settle cleanly.
Any actual/late handle gets immediate error/exit listeners and remains owned
until its real exit, even if termination was already requested. Unknown exit or
unclosed parent work remains unsettled; no synthetic spawned/closed receipt.
The fixture does not implement a fake late-acquisition adapter to count a pass.

## D2: cutoff, outcomes and raw reasons

Header/partial upload is staging, never effect admission. Complete payload,
grants, reservations and OPEN are checked before synchronous enrollment and
calling VFS/sink. Parent cutoff fixes the admitted set, not the staged set.
There is no rollback of completed or preadmitted effects. Normal cutoff MUST NOT
abort preadmitted cooperative VFS work. Caller cancellation stays live throughout
drain, wakes blocked sync work and requests termination immediately, zero grace.

0/1/2 mean intentional retirement/guest failure/private profile failure only after
confirmed actual Worker exit (if acquired or acquisition uncertain) AND parent
cleanup, with no overriding actual failure. Proven-none has no invented exit.
Actual caller/control/sink/cleanup values and presence/provenance MUST remain
raw; reason equality/status numbers do not establish provenance. Existing
command contract priority and raw-vs-Shell mapping remain unchanged. The harness
returns raw records plus status null for actual parent failures, not a fabricated
Shell mapping. It does not establish public command integration.

## D3: unchanged limits and strict reservation obligation

CAPS.json retains the named16MiB command-owned ledger,197056-byte SAB, old32/
young8/code8/stack4MiB V8 limits, and5s ADMISSION clock beginning at ownership
enrollment before startup. This is not5s completion/cleanup, whole-guest8MiB or
RSS containment. Physical slots3, active1; operations128, frames4096, wakes8192;
source256KiB, context64KiB, path1024B, metadata8KiB, errors1024B, per-operation1MiB,
raw read/write4MiB each, output1MiB. Shared caps never reset at cutoff or ACK.

Strict preallocation/reservation for frames, strings, copies, errors and cache
metadata remains REQUIRED. The candidate has a concrete named ledger but fails
to establish that obligation completely: its operation reservation releases at
cleanup/FREE before later bridge/postcopy and engine-journal retention close.
Internal clone/journal allocation admission lacks a public precharge hook. This
is an explicit K3 blocker, NOT an accepted weaker ledger or claimed16MiB bound.
Whole mutated guest graphs remain outside that named ledger, honestly unbounded
by it. Arbitrary provider producer allocation is not bounded by consumer copies.

## Public input blocker and conformance boundary

All66 permitted public source blobs authenticate to engine
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`. However `src/core.ts` statically
reexports `./lint.js`, and `src/lint.ts` is absent. Public root also references
missing modules. The existing63 emission bindings omit core/index emissions.
Therefore no permitted complete public entry can be loaded from these inputs.
No deep-import `run.ts`, export stripping, stub lint, generated private factory,
extra engine source discovery/download or moving/private checkout is allowed.
The source checkpoint stops before imports/compilation/Worker construction.

ROOT must supply/authorize an authenticated PUBLIC core/lint transitive source
closure and exact corresponding regular compiler/emission/tool/launch bindings,
then a new preseal and different review. Merely setting a grant boolean cannot
close this missing-input blocker. Original8 WRQ and original async/Q cases remain
held; eleven proposed instances/ten guests are ceilings, not executed coverage.

## Validation matrix

| Requirement | Concrete source/data | Evidence now |
|---|---|---|
| R1/F7 | ERRORS.json; preparation/errors.mjs | source only; real typed provider absent |
| R2 | RPC.json added edge; sync-bridge.mjs zero-result branch | unrun |
| R3 | RPC.json schemas; wire.mjs validators | unrun |
| R4 | owner.mjs receipt states | unrun; construction throw remains unconfirmed |
| K1 | static scaffold; public source intrinsics | finite-fixture candidate; universal descriptors blocked |
| K2 | hidden postcopy marker; parent outcome ledger | candidate only; actual guest/Shell proof missing |
| K3 | reservations.mjs; CAPS.json overlap obligation | known lifetime/precharge gap, HOLD |
| K4 | static entries/load guard; source/tool manifests | exact public input missing, STOP |

No model, syntax parse, harness import, Worker, engine, guest, compiler, install,
private read, network or F05 retest occurs. Later DATA checks only authenticate
sealed JSON/text bodies and finite counts; they cannot discharge this matrix.
