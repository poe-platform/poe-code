# Independent first-read contract review

**Bounded result: the original five still FAIL, unchanged, at 1200ms.** No waiver,
source change, new lifecycle API or release qualification. The evidence supports
a useful **optional pre-first-write cancellation policy for explicitly owned
output work**, not an already typed universal reader-demand guarantee. No minimal
production defect is demonstrated by these five against the current contracts.
Treating their stronger policy as native Bash parity would be a classification
error; preserving them as unresolved custom policy tests is appropriate.

The originals do **not** have a start/read circular dependency under current
execution. They start work, then allow head to exit, then stall waiting for a
stage cancellation that current policy does not issue before a successful write.
Adding demand-before-start would create a different circular dependency with
their middleware. These are distinct findings, not interchangeable explanations.

## Pin, preservation and scope

- Intent frozen before implementation investigation at 2026-08-27 09:13:05 UTC.
  HEAD `c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79`; source snapshot manifest
  `6d8589043618e623e35a63e92cbecc160b7f587335a69bba3e0b0f57e34dca8b`.
- Initial inspection saw `6d1beb36...`; concurrent HEAD advanced **before** pin.
  Pinned source is working-tree bytes, including three pre-existing tree-command
  dirty files, not a clean committed candidate. The index, full tracked binary
  diff, tracked source/config/test hashes and untracked path inventory are in
  `evidence/freeze.json`. No foreign holdout body was inspected.
- All 212 source files were copied and hash-verified before investigation and
  again after execution. Complete source avoids selectively omitting imports.
  The nine new controls use the copied source's compiled dist; unchanged
  originals use the copied TypeScript source with explicitly referenced existing
  root dev tooling. No root dist, dependency install or source fallback.
- `evidence/inputs.json` maps exact-byte `.data` archives to original paths.
  Raw current TAP/stdout/stderr and exact commands/timing/PIDs are under
  `evidence/runs/`. `evidence/summary.json` contains parsed per-case states,
  compiled artifact hashes and the actual 353-file scoped compiler inventory.
  Hashing all tracked tests at freeze is **not** compiling or running them all.
- Historical `first-read-evidence.json`, both first-read snapshot scripts, and
  the old full-gate first-read stdout/stderr are preserved byte-for-byte as data.
  Their old source and timings remain historical, not this run's identity.
  Historical 10-to-8 extraction was not duplicated. `ATTEMPTS.md` records the
  sole postprocessing correction; no original or control reruns were needed.

Exact key input SHA-256 values:

| Original path | SHA-256 |
| --- | --- |
| tests/shell/remote-close.test.ts | `0ca0886333c793dbddb5e14e2fdbb2a3bb457919dbf4e70d419f87fab6505474` |
| tests/shell/first-read-probe.ts | `b138e5572240533efb8cde733e0c5a9bbd1c960e431b9291c0a17a300b1c7ed6` |
| tests/stress/remote-cancellation/helpers.ts | `9e76ecf9ba6604fc2c4b94a96cf5b46ffed97de5e7d0c2524e138b4410e17678` |
| tests/shell/first-read-evidence.json | `2d0faecd40423539c2a74ab132785ab14a8565671d1fbbe4482819c9877da52e` |
| tests/integration/full-gate-20260827/evidence/recheck/shell-first-read-plain.stdout.log | `da05f82f2742e20bcf2c46d5b4f6c1eb58559a16b5ffc861a853b36164260d9a` |

## The exact five, not the cleanup five

`remote-close.test.ts:11` names six first-read scenarios. The separate sixth,
`first-read-head-zero`, proves head reads zero chunks and returns the owned input
once. The five custom failures all execute `producer | head -n 0; true` through
`first-read-probe.ts:98`. No pipefail; trailing true occurs only after the pipeline
settles, so it cannot rescue a pending producer. Outer child deadline remains
3000ms/1MiB; inner `bounded` remains 1200ms (`helpers.ts:25`).

All five require: successful empty stdout/stderr; caller signal not aborted;
observed stage signal aborted with code EPIPE; `closed` resolved before fixture
teardown; exactly one read, one return and zero active work; no unhandled errors
(`first-read-probe.ts:99`). On this run each child exits 1 from the exact inner
1200ms deadline, not a 3000ms kill. At pre-teardown capture all five have
`active=1, reads=1, returned=0`, caller not aborted. Each trace includes head
settling successfully. Later assertions are **not reached**, not separate passes.

| Case / exact fixture | Ordered actual events | Explicit promise vs requested stronger behavior; counterexample |
| --- | --- | --- |
| first-read-local, lines 22/74/97 | source.next pending -> started resolved -> head:0 -> 1200ms failure | pipeBytes reads source then writes; signal cancellation is supported, but it does not declare the source exclusively output-owned or arm stage cancellation before write. Requested: abort pending first read when stdout closes. C2 shows legitimate preparation before reading downstream; C4 and shared-cursor controls prohibit unconditional whole-stage/borrowed-source cancellation. |
| first-read-s3, lines 44/47 | metadata calls -> getObjectStream -> source.next pending -> head:0 -> failure | Named-file streaming propagates a signal and has cleanup paths; no ByteSink demand/ownership token promises to abort that signal at this point. Requested: bind this file transfer's lifetime to output close before its first byte. C3 proves native pre-output effects can already happen; analogous output-only policy must not cancel unrelated stage effects. Mock S3 only, not deployed-provider evidence. |
| first-read-webdav, lines 49/55 | PROPFIND -> GET -> headers flushed, body withheld -> head:0 -> failure | GET/body cancellation follows explicit supplied cancellation, but stdout has not attempted a write. Requested: close owned body work on consumer exit. C4/C6 preserve independent work and diagnostics when stdout is unused. This is the original loopback fixture only; Poincare's provider issue is outside this review. |
| first-read-curl-body, lines 49/55/71 | authorized loopback GET -> headers flushed, no body bytes -> head:0 -> failure | Documented sink-error cleanup applies when a sink error occurs; no stdout write has supplied one. Requested: cancel the output-bound transfer before its first body byte. C7 shows stderr may precede stdout; file-only/mixed transfers must not inherit an unrelated stdout cancellation policy. |
| first-read-curl-headers, lines 49/55/71 | authorized GET -> no headers sent -> head:0 -> failure | Even the response promise is pending: a body-copy-only fix would miss it. Requested: cancellation of the owned request during pending headers. It is not a different head defect. Same stderr/file effects caveats; any optional binding must cover pre-response acquisition, not just byte delivery. |

The original HTTP `reads` variable counts GET entry; it is **not** a count of
client body iterator calls. Headers are sent for WebDAV/curl-body, but the fixture
does not log exactly when the client consumes them. Do not infer a first body
read or readable payload from that counter. The local/S3 pending-source counter
really is generator execution on next. The printed `abortedBeforeTeardown` is
the **caller** controller, not a direct stage-signal measurement. Current code
and the unresolved abort-sensitive generator explain the noncancellation; the
printed boolean alone would not establish stage signal state.

## Actual contract and runtime mapping

Pinned references are additionally preserved as `.data` under `preserved/src/`.

- `contracts/io.ts:4`: ByteSource is AsyncIterable of Uint8Array; ByteSink has
  only `write(): Promise<void>`. BytePipe adds readable/writable/close/abort, not
  a public demand/start notification. `command.ts:23` supplies signal and the
  existing optional cooperative cleanup hook, not a pre-output ownership promise.
- `contracts/io.ts:26`: TransformStream has bounded readable capacity and a
  writable queue. Successful write acceptance can precede consumer next.
  `io.test.ts:64` explicitly requires this. C8 accepts byte A before any read,
  blocks the next write, then rejects pending write/close/read on exact caller
  cancellation. High-water mark is a backpressure threshold, not proof that no
  work/chunk can exist without demand, nor a universal memory cap on one chunk.
- `contracts/io.ts:131`: pipeBytes requests source chunks, awaits each sink
  write, then requests the next. The first source read necessarily precedes its
  first sink write. readBytes/abortable handle supplied signal cancellation and
  observe late rejections; opaque host work is not magically preempted.
- `shell/runtime.ts:315`: all stages launch. `written` is populated only after
  a successful **nonempty** outgoing write (line 337). When a downstream stage
  completes it aborts its incoming pipe; next-turn stage cancellation targets an
  unfinished upstream stage only if that set contains it (line 365). An actual
  EPIPE thrown by a later first write also aborts that stage. With neither event,
  Promise.all still waits for the pending producer. This deliberately preserves
  no-write effects/statuses and zero-byte-write behavior.
- `contracts/plugin.ts:4/25` and `first-read-probe.ts:78`: middleware really
  waits on `started.promise` **before** calling/awaiting next for head. There is
  no tracked function named `waitForStarted`; that phrase is a description of
  this actual barrier. `first-read-independent.snapshot.mjs` similarly waits
  on `entered.promise`, but that historical script is not a new execution input.
- `commands/network/README.md:89` promises cleanup on a downstream **sink
  error**, not notification of an unused sink's consumer leaving. Curl awaits
  transport at `network/curl.ts:172` before reading the response body. S3's
  `streamRead` (`fs/s3/filesystem.ts:811`) passes the signal into its transport
  and body loop. These paths cannot infer a consumer read from ByteSink.write.
- `contracts/command.md:111/129` explicitly distinguishes internal close from
  caller abort and the custom first-read issue from cooperative cleanup. Its
  historical acceptance paragraph is not current evidence that Arch5 is broken.

Start-of-invocation = dispatch/middleware entry; source start = source operation
actually begins; attempted write = call to sink; acceptance/readable availability
may mean queued bytes; delivery = consumer next resolves with bytes. C1/C2/C8
distinguish these in real traces. None of these terms can silently stand in for
all the others.

## Circularity and meaningful controls

**Current originals:** source starts -> middleware barrier releases -> head exits
without reading -> incoming pipe closes -> producer remains blocked before write.
No dependency waits for a reader to permit source start; this is a missing
stronger cancellation trigger, not an original start-demand deadlock.

**C2, real Shell middleware:** source.next event 5 -> middleware wait event 7 ->
VFS preparation event 8 -> next event 9 -> consumer attaches event 11 -> stdout
attempt/accept events 12/13 -> delivered event 16 -> response-like sink event 17.
It succeeds with payload and preparation preserved. Actual Express runtime is
unavailable (both root/benchmark resolution MODULE_NOT_FOUND); this is not an
executed Express server, Node HTTP integration or Express-next Promise claim.
Official Express docs supply only the corresponding before-next design evidence.

**C9, explicitly synthetic harness-only gate:** producer waits for demand event 5
-> middleware waits for start event 7 -> cycle observed event 8; consumer never
enters. The dependency graph is start <- demand <- next <- start. Explicit caller
abort ends it with the same reason. This models the contradictory demand-before-
start setup; it implements no product API and is not an original-five pass.

**After-first-write is positively verified:** C1 events 8/9 record successful
nonempty write then a pending read; event 13 delivers `first\n`; downstream exits
15; producer finally observes EPIPE 17; public settlement occurs 19, status 141
with pipefail. Existing remote controls independently assert a pending read was
entered, active zero, source return/finally, exact output/status and no caller
abort. They do not merely time out a command that never wrote anything.

| Cohort | Actual result |
| --- | --- |
| Original custom five, unchanged | **0 pass / 5 fail**, all inner 1200ms |
| Existing separate head-zero | 1/1 pass |
| Existing remote-close, after-write and no-write | 19/19 pass |
| Existing ByteIO contracts | 28/28 pass |
| Existing shared cursor/lifecycle cases | 5/5 pass |
| Existing selected streaming cases | 4/4 pass |
| Frozen new logical controls C1-C9 | 9/9 pass |
| Native counterparts of C3-C7, not new logical cases | 5/5 expected outcomes |
| Copied-source build / copied-input noEmit | exit 0 / exit 0 |

No all-corpus percentage; no repetition inflated into new cases. Original 5
remain red even though 57 existing controls and 9 new controls passed.

## GNU 5.3 native counterexamples

Executable `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA-256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`;
version `5.3.0(1)-release`, build profile `aarch64-apple-darwin25.4.0`.
Execution host Darwin 25.4.0 / macOS 26.4.1 build 25E253, arm64. Explicit C locale,
UTC, umask 022, --noprofile --norc, no inherited BASH_ENV/credentials. Bash printf,
test and no-read consumer are builtins; timing uses authenticated Darwin sleep,
not GNU coreutils. `evidence/native-tools.json` records binary identities.

The unchanged originals use virtual head -n 0. Native counterexamples explicitly
use no-read shell functions ending in `:` instead of silently substituting an
Apple/GNU head. Consumer markers synchronize entry/exit and an extra bounded
delay precedes attempted output; raw PIPESTATUS confirms the broken pipe.

| Control | Native stdout / stderr | pipefail status; component statuses | Retained task-owned effect |
| --- | --- | --- | --- |
| C3 preparation before first output, reader never reads | empty / empty | 141; 141 0 | effect=`prepared` before consumer proceeds |
| C4 independent side-effect-only work after reader exits | empty / empty | 0; 0 0 | effect=`kept` |
| C5 successful empty-output work after reader exits | empty / empty | 0; 0 0 | closed marker, no payload |
| C6 delayed error-only work | empty / `delayed-error\n` | 7; 7 0 | closed marker |
| C7 diagnostic before first stdout write | empty / `diagnostic\n` | 141; 141 0 | preparation/closed markers |

These directly refute universal suppression/abandonment of pre-output effects
because the downstream never reads. They do not emulate JavaScript middleware,
remote-body cancellation or a Bash reader-demand API. GNU manual 5.3's synchronous
pipeline wait and status clauses support this interpretation; precise primary
URLs, relevant clauses, retrieval limitations and Node/Express distinctions are
in `primary-sources.md`. No GNU/Linux, all-Bash, or deployed-provider parity claim.

## Root decision: optional policy, not an implementation request

No production edit is requested on the strength of this cohort alone. First decide
whether the desired feature is **owned-output cancellation on reader close** or
**strict read-demand scheduling**; they are not equivalent.

1. A narrow opt-in policy could bind a deliberately output-only operation to its
   actual destination's closure before transport/first read, with cancellation
   and owned cooperative cleanup. Defaults, general pipeBytes, borrowed/shared
   stdin and independent effects must remain unchanged. Already completed effects
   cannot be undone. No global stage cancellation unless explicitly consented to.
2. If strict demand is desired, define it as an outstanding consumer pull, not
   writer ready or a free buffer slot. Permit invocation/setup independently; only
   opted-in output work waits. Host code must not put its awaited start barrier
   behind that same demand gate. Originals' required one read contradict a
   zero-read/no-start interpretation for head-zero; use new separately approved
   acceptance, never silently rewrite these frozen inputs.
3. EOF/empty success and terminal errors need completion paths not dependent on
   delivering a first stdout byte. stderr is independent unless actually routed
   to the same destination. Curl file output must not be canceled by unrelated
   stdout closure; mixed outputs require explicit ownership choice. A headers
   wait needs pre-response coverage, not just a body-copy wrapper.
4. Caller cancellation must wake demand waits with reason identity; consumer
   close should report the destination-close outcome; ownership must cover admitted
   requests and cleanup without waiting for arbitrary opaque host promises.
   Race precedence for completion/error/close and bounded queues must be specified;
   no no-op write or timeout can stand in for that contract.
5. Root assigns contract/type ownership first, kernel scheduling/close ownership
   second, command/adapter opt-in ownership per operation, then independent
   acceptance ownership covering original five plus existing after-write/shared
   behavior. No owner has been given a source edit by this review; no API shape
   or rollout is approved here.

## Reproduction and closure limits

`restore.mjs` reconstructs the exact pin from git blobs plus preserved dirty
source data, and checks every restored hash; it refuses existing scratch state.
Existing dependencies must still match `evidence/inputs.json`; no installation.
The recorded commands in `evidence/runs/*.json` are authoritative. Run from the
restored candidate using those argv/cwd/environment values, with fresh owned
capture labels rather than overwriting immutable evidence. Build only there;
new controls import only that compiled dist. `.data` archives are never test
discovery inputs. Retained .mjs files are maintained harnesses, syntax-checked and
executed where applicable; the full root test/typecheck gate was not run.

Every supervisor child delivered close, stdout/stderr drained, no remaining owned
PID/process group was detected and no kill was sent. Original wrappers additionally
report residual=false for all 25 subprocess scenarios. Original failures clean up
via their existing caller-abort/dispose/fixture-finally paths **after** recording
failure; this proves test containment, not pre-teardown acceptance. No SIGSTOP,
watchers, native executables or caches are retained. Final cleanup/discovery proof
and evidence hashes are in `evidence/closure.json` and `evidence/artifacts.json`.
This is local owned/cooperative work only, not proof of global host quiescence.

Accepted Arch5 public cleanup verification c3a3647 and pending default-containment
six are separate supplied facts, neither rerun nor inferred broken here. Poincare
owns the bounded WebDAV consumer issue. Current integration may advance HEAD;
this pin is not chased/requalified. **Release remains RED** until the exact later
candidate is assigned and actually rerun. Root must verify this leaf's actual
CLOSED state after final return. This bounded review is not 72 hours or completion
of the broader virtual-bash goal.
