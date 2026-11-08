# Independent Worker design review

2026-08-28. **SOURCE/DATA REVIEW; implementation and runtime qualification HOLD.**
Reviewed author `53e5bffd5e808b198cfda2ff3a5cedccf88990e9` and additive ROOT
selection `700651e5ec6f50435a0298845c411a8f2a5a386f`. No production changes,
Worker/engine/compiler/native execution, private access, or apply_patch changes.
This review does not duplicate Raman's private-ABI experiment review.

## Verdict

The ordinary synchronous public callback seam is a credible implementation route.
It does not require the private await-for-sync ABI: the trusted callback can block
its Worker while the parent performs asynchronous VFS work and publishes a SAB
response. **The proposal is not yet an implementable complete protocol**: body
upload handoffs, frame-number ownership, delivery evidence, parent operation
admission, and completion/status policy need the precise choices below. These are
design obligations, not observed product defects.

Recommend **a separately named, explicitly selected L-entry-return, sync-I/O
first slice**, with the existing NP1-CJS CLI and text/JSON use cases. Keep original
NP1 whole-guest8MiB/all-jobs-settled HOLD. Do not claim that fixed transport storage,
V8 heap constraints, termination, or this review establishes either original
requirement. An async/explicit-exit extension remains useful but must not delay or
be silently included in the smaller slice. ROOT must approve that scope distinction.

## Authentication and actual activity

Preseal `74af3106`; checker frozen `b47d78d8`, corrected **before execution** at
`5032eb71` to avoid an unnecessary oversized tool-binary read; final source-read
recipe `93e40b2c`. No engine file was imported or compiled.

`RESULT-v1.json` records independently recomputed public commit, **13 raw Git
tree objects, 66 blobs and path memberships, 37 function-body hashes**, all
proposal member hashes, and the bijection of **eight L obligations to WRQ01–08**.
Git tree names were read as raw bytes terminated by NUL, not quoted displays.
The archive decoded to 1,073,919 bytes. The main checker accounted 5,433,088
logical processed bytes. Fixed layout arithmetic is
`64 + 3 * (128 + 65536) = 197056`; counters fit signed32 ranges. Arithmetic and
binding checks are **not 37/37 or 8/8 semantic/runtime passes**.

Three serial DATA-only Node invocations occurred: structure discovery, checker,
remaining source excerpts. No subject child, Worker, engine evaluation, service,
or installation occurred. Captures total well below16MiB; logical processing
below64MiB; each DATA invocation completed within its bounded tool call, with no
ongoing sessions. Elapsed research/documentation time is not the five-minute DATA
execution allowance. Node reported22.22.2; its binary was **not rehashed or
qualified** in this review. No tool/SafeJS loaded-code claim is made.

Preserved harness blemish: after the checker wrote its completion report and
empty stderr, the surrounding zsh attempted `status=$?`; `status` is read-only.
The shell tool returned1. The report is genuine completed DATA output, but that
wrapper did **not capture the checker exit code**. It was not rerun or counted as
a clean execution receipt. The third invocation used `result` and returned0.
Discovery stdout structure and this error are recorded in `ACTIVITY.md`.

## Public source findings (all references are archived bb23 bytes)

The 37 exact body bindings and hashes are in `RESULT-v1.json`; source excerpts are
in the two bounded `.data` files, not an executable engine snapshot.

| Group | Source conclusion | Qualification consequence |
|---|---|---|
| S1 `src/run.ts:162,477` | Public run creates/uses a Budget and resets it; returned-Promise rejection check waits two microtasks. | One run per invocation; no budget reset/replay loop. Run completion is not an all-jobs receipt. |
| S2 `src/interp/host-bridge.ts:116,247,269` | Arguments are copied before `Reflect.apply`; ordinary callback is invoked synchronously. Non-Promise result returns through copying. | A blocking callback can return genuine text/undefined, not a guest Promise; post-copy validation cannot promise pre-copy admission. |
| S2 `:459,477,719` | Result copying has a fresh WeakMap per return; local Error metadata is selected; arbitrary thrown primitives become guest errors. | Do not claim cross-call guest identity or raw parent-error identity through the bridge. |
| S3 `src/interp/interpreter.ts:284,3451` | Ordinary calls hold their execution turn; async flag/result wrapping is significant. | A JS `async` callback is not a substitute for sync fs. Its host waiting time cannot be treated as guest progress. |
| S4 `src/interp/jobs.ts:47,91`; `async.ts:253` | Explicit await releases/reacquires the execution job; drain counts20 idle turns. | Do not retrofit FIFO/quiescence guarantees from idle turns; parent sync completion must be independent of Worker callbacks. |
| S5 Promise/values/tracker bindings | Promises register tracking; rejection observation is not a full pending/runnable census; flush is20 microtasks. | L reports unknown guest pending/abandoned counts; WRQ04-Q stays unselected/unrun. |
| S6 `src/interp/cancel.ts:20` | Cancellation wraps values with a scoped identity map and local signal checks. | Parent control provenance/presence/value must remain outside guest and DTO equality; Worker signal/error conversion is not parent identity proof. |
| S7 `src/interp/exceptions.ts:121,186` | Guest catch/finally and thrown-value conversion are real interpreter behavior. | Modeled terminal exit cannot be an ordinary catchable throw. Never depend on guest finally for host cleanup. |
| S8 `src/modules/registry.ts:77` | Wrapped module exports are cached for import binding, not a runtime CJS require cache. | CJS/JSON aliases need one invocation-local guest cache; host `require` returning the same object repeatedly is insufficient. |
| S9 `src/interp/budget.ts:115,131,203` | String/array checks and reset are not whole-process allocation accounting. | The16MiB ledger covers named command reservations only; copied guest graphs, parser allocations and engine records remain separate. |
| S10 public core/index exports | Public run/Budget and parser-related exports exist. | No private factory/deep import is necessary to propose this seam; exact future public entry/transitive closure still needs authentication. |

The untouched current `src/contracts/command.ts` exposes signal, sinks, VFS,
invoke and cleanup registration, **not a public shared-Budget charge API**.
Consequently the practical integration is normal command admission once, existing
parent-owned sinks/invocation cleanup/signal, and one private engine budget. Do not
promise engine-step charges into a public Shell counter that does not exist; do
not add a new Shell or map bytes/host calls to command counts. This is a current
interface inspection, not acceptance of unrelated live production.

## Findings that must be resolved in the implementation packet

### F1 — Copy-before-validation and identity are real seams, not fixed by SAB

Even a primitive-only RPC callback receives arguments after engine copying.
An invalid guest object graph can therefore incur work/retention before provider
validation. Post-clone own-data validation is still necessary but cannot inspect
the original descriptors. A trusted **interpreted** primitive facade, exact
whole-source allowlist, and proof that guest code cannot reach its raw transport
callbacks are needed if pre-bridge rejection is claimed. No native eval or
string-to-Function bootstrap. Without that proof, disclose the pre-copy gap and
do not admit an arbitrary guest-memory containment claim.

Inject fixed module records once and retain them inside the same guest invocation.
Cache `fs`/`node:fs`, `path`/`node:path`, `process`/`node:process` by canonical module
key; JSON cache by a proved virtual namespace/path binding, not fabricated
per-client storage identity. Recheck authority on each require, including cache
hits. Keep JSON parsed values guest-side and mutable through aliases. A second
run to create or retrieve the cache would reset engine accounting and is not the
solution. Trusted scaffold hiding/freezing/call arity must be qualified before use;
the source review does not establish it already works.

### F2 — RPC needs a complete transition/publication table

The six states and prose `reciprocal owner handoff` do not define upload credits,
ACK payload ownership, phase legality, final-delivery evidence, or a global frame
allocator. In particular both agents publish frames while the listed global
header has no frame-counter owner. A naive local counter is ambiguous with two
async slots and a sync slot. Frame allocation order also cannot be treated as
cross-thread observation order.

Recommended minimal private revision, **not existing protocol proof**:

1. Retain the197056-byte SAB. Name one currently-reserved global word as a
   bounded atomic frame allocator; update zero-reserved validation/version.
   Allocate1..4096 with checked CAS, never wrap. Track uniqueness, exact predecessor
   and phase **per slot**; do not reject a valid lower-numbered frame in another
   slot merely because it was observed later. Operation seq remains Worker-owned
   invocation-monotone1..128; parent admission ordinal is a different counter.
2. `FREE -> REQUEST(metadata)` by Worker, then parent CAS to `PARENT_OWNED` before
   copying. After validation, a write receives `RESPONSE(upload-credit)` with
   empty payload. Worker consumes that credit, writes the next bounded request
   chunk while it exclusively owns the payload, then publishes `ACK(upload-data)`.
   Parent CAS to `PARENT_OWNED` before copying it. Repeat credit/data; no zero-size
   nonterminal chunks, no overshoot. Total0 skips this loop.
3. Response metadata/body use parent `RESPONSE` then Worker `ACK` with no upload
   payload. Worker copies before ACK; exact lengths and total are checked before
   final ACK. No payload writer runs while its peer reads. Result-tag/phase
   combinations must distinguish upload credit from result text/errors.
4. Only final ACK plus settled/closed parent ownership permits `FREE`. Intermediate
   ACK never means operation completion. After cutoff, retire without demanding
   ACK; do not synthesize one. Unexpected state/duplicate/stale/length failure
   closes admission and retains original owned operations for cleanup.

This uses existing state names but **adds exact phase/tag semantics**; it must be
versioned, not retroactively declared present in RPC-v1. A finite whole-module
synthetic model must test all transitions before any actual Worker admission.

### F3 — Keep transport admission separate from irreversible effect admission

Enroll the command cleanup before creating Worker/ports/SAB or acquiring stdin.
Reserve a transport/staging record before receiving any data. It is not yet a VFS
effect record. At complete payload, validate again and synchronously commit
parent OPEN/session/route/grant/reservation check plus operation enrollment; only
then call VFS/sink. No await or user callback between the final check and enrollment.
Any synchronous provider throw is captured with that record already owned.

Parent cutoff uses the same serialized gate. A half-uploaded write cannot acquire
effect authority afterward. A fully admitted write may finish after cutoff, with
its original path/payload/grant and cleanup; no new guest request can do so.
Normal retirement **does not abort those jobs**. Actual cancellation does. No
postcutoff retry, fallback path, newly authorized cache load, or slot reuse.

### F4 — Cancellation must not race by overwriting an owned payload

Parent stop is a separate permanent atomic latch plus wake epoch. Never write a
stop DTO into a slot currently being filled/copied by Worker. Before wait, sample
epoch and recheck stop/state; loop after every wake/timeout. Async response ACKs
must not gate slot0 progress. A late response checks the original ownership
record and closed gate before any shared-memory publication.

Parent retains raw reason presence/value and provenance including false,
undefined and object identity; DTO stop has no reason. A caught guest error cannot
reopen the parent gate. Stop, Worker error, actual exit and parent cleanup are
separate facts. Sink closure enrolls only its destination and must not abort
sibling file/stderr jobs. Preserve root-caller priority and actual escaping
failure/cleanup identity; do not elevate ordinary guest-caught FS errors.

### F5 — Define delivery and cutoff, not just status labels

Recommend parent commitment as the cutoff linearization and zero deliberate
postcutoff response service, as proposed L-CUT-1. **Final ACK establishes transport
consumption, not by itself bridge delivery or a guest catch/reaction.** Require a
separately source-bound handoff witness observed before cutoff before discarding a
known parent rejection. For the proposed sync-entry-return slice, ordered final
ACK plus a later genuine run-settlement terminal event can be a candidate witness
that an ordinary synchronous callback unwound through the bridge; qualify the
actual callback/copy/error path and sequence, not just the event names. That
reasoning does not apply to async slots or explicit exit. Those need an explicit
post-handoff receipt from trusted bridge/facade code, not a pre-resolution ACK.
If no such witness is available, retain the known rejection as undelivered failure;
it can prevent exit0. This is a concrete proof gap for the full async design and
one reason to start sync-only. It is not Node Promise ordering.

For primitive `-p`, the trusted Worker controller must submit and **await actual
publication** of the formatted primitive+LF through the same output gate **before**
its terminal event. Reserve/count the print, including LF, against output/effect
limits. A failed print follows real sink failure policy, not clean status0.
No result may acquire a fresh print privilege after terminal cutoff.

The admission deadline must not become an invented cleanup deadline. A concrete
recommendation is in ROOT-CHOICES.md. Unknown Worker exit/unclosed host work means
no clean public settlement, not a quick numeric `quiescence-unknown:2` receipt.

### F6 — Boundaries still required for16MiB/heap claims

Name every reservation category and transfer/release point: source/context copies,
SAB, read decode/return copies, write staging, transport metadata, output chunks,
guest cache input, parent job records and retained undelivered error records.
Check before acquiring/encoding/copying, with checked arithmetic. Bounded strings
or JSON input do not bound arbitrary decoded guest graphs. Host callback journals,
clone machinery and engine/native buffers must not be silently charged as zero.

Parent producers can yield a large chunk before the consumer can reject it.
Therefore a hard bound on producer-owned/transport-copy memory requires a
qualified producer contract; consumer counters alone bound only retained copies.
Keep that caveat explicit rather than silently excluding all real adapters.

Fresh static trusted entry and complete dependency closure must be pinned. Explicit
env/execArgv must not forward guest NODE_OPTIONS/loader settings. Use separate
bounded captured Worker stdout/stderr for trusted-runtime faults, never ambient
parent stdio; guest output remains the authorized VFS bridge. Provider/entry JS is
trusted host authority, not a sandboxed adversary. Validation does not turn
arbitrary host callbacks into isolated code.

### F7 — Error vocabulary is incomplete for real VFS

RPC-v1's finite FsError code list omits legitimate boundary cases such as ELOOP,
ENAMETOOLONG and ECANCELED. Qualification cannot prove a backend will never emit
one on every future operation. Before implementation choose either an extended
finite typed-code table tied to the existing contract, or a bounded opaque guest
failure plus retained parent original and explicit profile failure. Do not turn
unknown codes into ENOENT, successful undefined, or denial. Prefer the former for
ordinary typed FS errors; local/caller control still uses parent provenance, not
code spelling. Missing required error authority or sink failure must not be hidden
by a diagnostic write.

## Eight obligations: source status, not execution score

| Obligation | Review disposition / required next proof |
|---|---|
| L01/WRQ01 | Ordinary sync callback seam supported; actual blocked read order, primitive output publication and terminal receipt still unrun. |
| L02/WRQ02 | Error-copy limitations verified; exact delivered/undelivered handling and parent false/undefined/object identity need runtime witnesses. |
| L03/WRQ03 | Fresh return-copy map verified; guest module/JSON cache identity, reauthorization and retirement unproved. |
| L04/WRQ04 | Q not selected; L needs trigger selection. Sync-first defers promise-fs/guest-exit inputs rather than passing/removing them. |
| L05/WRQ05 | Independent atomic stop/wake design appropriate; blocked callback/cancel/late publication tests not run. |
| L06/WRQ06 | Distinct actual exit and parent cleanup required; held cleanup and output-only closure remain unrun. |
| L07/WRQ07 | Own-data/provenance rules sound at trusted sender/receiver; phase/frame/cutoff schedule additions required (F2–F4). |
| L08/WRQ08 | Layout arithmetic verified; actual entry/loader closure, V8 limits, failure containment and memory ledger unqualified. |

## Primary normative references

Read official Node22.15.0 `worker_threads` constructor, exit, message and terminate
sections, and ECMA-2622024 Atomics/agent semantics. Node documents external memory
exclusions and parent V8-flag overrides for Worker resource limits; termination
settles on exit without a hard duration. Worker native stdio forwards by default
unless separately captured. These support the separation of resource/exit/parent
cleanup obligations, not a containment pass. Atomics wait compares the expected
value as part of waiting; it does not establish a protocol's higher-level
ownership or give a hard scheduling deadline.

- `https://nodejs.org/download/release/v22.15.0/docs/api/worker_threads.html#new-workerfilename-options`
- `https://nodejs.org/download/release/v22.15.0/docs/api/worker_threads.html#workerterminate`
- `https://tc39.es/ecma262/2024/multipage/structured-data.html#sec-atomics.wait`
- `https://tc39.es/ecma262/2024/multipage/executable-code-and-execution-contexts.html#sec-agents`

Documentation version is not the processor's Node22.22.2 runtime qualification.
Public-source line numbers in this report refer to authenticated archived bytes;
the web renderer collapses some blank lines and is not the hash authority.
