# Independent review: NO-GO for production

The static, invocation-owned native-RegExp worker is a reasonable **conditional
design direction**, not a production-ready implementation. Preserve it for an
owner revision; do not integrate this frozen prototype unchanged. Two frozen
requirements fail: unexpected idle exit retains shared capacity and an abort
listener, and a live input stream cannot produce its first ordinary result
until the batch fills or EOF arrives. No author or product source was changed.

## Scope, identity, and denominators

This DIFFERENT INDEPENDENT REVIEW leaf owns only new `design/review/**` files.
No delegation, dependencies, product subprocess implementation, author fixture
changes, author runner execution, benchmark rerun, or production integration.
The reviewer read the actual grep/rg dialects, author source/fixtures/harness,
accepted historical `df4d05b` report and the author's completed REPORT.md.

* Author source freeze: `4484026b9e0f87359733ac5f2dcbd49798473aa6`.
* Independent expectations/static harness committed **before probes**:
  `ad4c5adda0ea430438a1d3235520760270ad882e` (`PLAN.md`, `fixtures.mjs`,
  `child.mjs`, `run.mjs`, `prepare.mjs`, `.gitignore`). No frozen expectation
  or harness was revised after execution. `evidence/harness-identity.json`
  verifies all six current files against that commit and records their hashes.
* Actual isolated build recorded **2026-08-27 05:00:45.291 UTC**. Node
  **22.22.2**, V8 **12.4.254.21-node.39**, Darwin arm64, TypeScript **5.9.3**.
  Local installed metadata only; no external lookup or blocked-URL retry.
* Existing tsc with the exact author's config and only outDir redirected to
  `review/.temporary/js`: **197 frozen source/config/compiler/type hashes
  match, 183 compiler-listed input hashes match, all 17 emitted JS hashes
  match**. These include four prototype and thirteen product runtime modules.
  No use of or mutation to the author's `.build`, which may be removed.
* `evidence/build.json` SHA-256:
  `7c75b9583b6b9495340deefd0cb495a7bd2f0e576ab2542fc3d8c8e819c0b0f6`.
  Node executable SHA-256:
  `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
  Compiler `_tsc.js` SHA-256:
  `e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419`.
* Metadata correction, without overwriting raw evidence: `build.json`'s
  `reviewFreeze` field is the **live build-time HEAD `970adf2`**, advanced by a
  concurrent owner, not the independent harness freeze. The true freeze is
  `ad4c5ad` above. Dirty concurrent paths remain recorded and untouched.

**Independent counts:** 18 children = 16 benign scenarios (14 pass, two retained
failures) plus two reserved potentially pathological executions (both meet
their frozen containment outcomes). This is not 18 parity tests or a full gate.
Zero outer kills/retries/warmups. Twenty-two workers were created across these
children, at most one live at a time in each child; 22 worker-backed client
disposals were awaited. One idle-exit worker was externally terminated first, so the disposal
counter is not evidence of 22 automatic termination paths. Every exact child
exited, disconnected, closed both streams and emitted close. Final pending
requests, capacity ownership and inspected listeners are zero after recorded
cleanup. The known failure still needed explicit reviewer cleanup.

Historical seven risky executions + author three + reviewer two = **12 total**;
**zero reserved executions remain**. Do not run either risky row again. Native
dangerous current-tool baselines are reused from `df4d05b`, not re-executed.
Fourteen historical source-hash overlaps have zero drift. Author counts remain
separate: its 178 children/144 benchmark runs are not independent review runs.
The reviewer verified all 183 author evidence hashes without executing them.

## Findings for root and source owners

### 1. Idle worker exit retains capacity and signal listener

**Blocking lifecycle defect.** Exact static repro is the `idle-exit` branch in
`child.mjs`; raw result is `evidence/idle-exit.json`. Start a benign client,
await ready, terminate its exact worker handle, await that exit, then observe
40ms without calling client.dispose or starting another request.

Observed before reviewer cleanup: worker threadId **-1** and exitCode **1**,
client created=1/terminated=0, no pending request, releaseHeld=true,
capacityActive=**1**, abort-signal listener count=**1**. Node had already removed
the four worker transport listeners (all zero); this is **not a live leaked
worker thread**. The retained client ownership nevertheless prevents other
clients using that shared Capacity from acquiring the slot. Original assertion
failure `1 !== 0` remains in the raw file. Awaited explicit dispose subsequently
released everything; that does not turn automatic cleanup into a pass.

Root cause: `../client.ts:52` exit callback calls fail but not dispose. With no
pending ready/batch caller there is no catch/finally to clean it up. The error
and abort callbacks do start disposal, and those independent idle tests pass.
An owner should route terminal exit through an idempotent cleanup path, preserve
the original error/exit identity, and make lifetime completion observable to
the command owner. Keep awaited caller-finally disposal for ordinary success.
Do not promise a lease for an indefinitely unused ready client.

Related **source-only, not newly executed** warning: unsolicited idle reply
(`../client.ts:42`) and stdout/stderr failures also call fail without starting
disposal. Audit all terminal paths in the approved fix; do not generalize this
single injected-exit result into crash/resource-exhaustion coverage.

### 2. One available ordinary line cannot flush on a live stream

**Blocking integration/liveness gap, already disclosed by the author.** Exact
static repro is `live-source`; raw result is `evidence/live-source.json`.
The source yields `{text:'r', all:true}` once, then its next read deliberately
stalls without EOF. Consume the first result with batchSize 16.

At the frozen 40ms observation: no first result, **two source reads, zero
workers, zero requests**, and no worker deadline capable of flushing the batch.
The raw assertion says `First ordinary output must not wait for a full batch
or EOF`. The reviewer explicitly released the owned stalled read with EOF;
only then did the first matching result appear. Iterator return and explicit
source cleanup completed, and the created worker was disposed. This is not a
head-n0/pre-first-write cancellation scenario or a native-regex timeout.

Root cause: `../client.ts:120` awaits the next source row; only row-count,
subject-byte overflow on a later row, or EOF yields the buffered result.
Source inspection establishes the unbounded wait; the 40ms test is an
observation bound, not a newly imposed product latency contract. An owner must
flush partial available input at a meaningful input boundary or bounded
latency, preserve ordering and awaited downstream backpressure, and own any
pending read so cancellation/consumer return cannot abandon it. Do not simply
race and forget a source.next promise. The existing finite-input paused/return
tests pass, but they do not solve this first-output dependency.

## Frozen results

Durations below are child scenario wall time including the prescribed waits,
startup and cleanup; not performance comparisons. Exact unrounded measurements
and observations are in per-scenario JSON and `evidence/audit.json`.

| Scenario | Outcome | ms |
| --- | --- | ---: |
| captures | pass: optional, empty and unmatched numbered captures | 25.747 |
| unicode | pass: Unicode fold and g/gu empty-match advancement | 57.914 |
| selection | pass: native/bounded difference and tool ordering retained | 45.637 |
| dialects | pass: actual accepted/rejected tool paths and byte edges | 2.716 |
| preabort | pass: zero workers/requests/source reads | 0.551 |
| startup-abort | pass: no init request; cleanup before rejection | 3.853 |
| idle-abort | pass: automatic cleanup before manual finally | 67.750 |
| paused-abort | pass: automatic worker cleanup; no extra source reads | 66.398 |
| idle-exit | **FAIL: capacity and abort listener retained** | 67.861 |
| idle-error | pass: injected transport error starts automatic cleanup | 65.945 |
| malformed | pass: malformed active reply/compile failure reject | 41.142 |
| caps | pass: input row/pattern count/result caps fail closed | 27.937 |
| live-source | **FAIL: first output waits for batch or EOF** | 68.104 |
| consumer-return | pass: no paused reads; return awaits cleanup; reuse | 83.274 |
| capacity | pass: shared contention fail-fast and same-client BUSY | 43.192 |
| dispose-late | pass: idempotence, late handlers, capacity release | 46.751 |
| risk-default | pass: no-signal WORK_DEADLINE, awaited termination | 77.809 |
| risk-abort | pass: explicit in-flight abort, awaited termination | 22.015 |

The malformed active reply was injected on the real worker's EventEmitter;
the idle error was a synthetic error event, not a native worker crash. The
idle exit was real external termination of the exact worker. Late-event testing
calls captured handlers after cleanup; it does not emit an unhandled `error`
event on an intentionally listener-free EventEmitter. Strict unhandled rejection
mode produced no child error/stderr. These distinctions limit the claims.

Both risky rows use only `^(a+)+$` and exactly 24 ASCII `a` plus `!` (25 bytes,
50 UTF-16 storage bytes), one scan in one preinitialized worker. No risky
same-thread oracle or additional pattern. Each static child has strict
unhandled-rejection, 64MiB old-space and 2MiB stack flags, bounded IPC/output,
and exact-handle 250ms **after-ready** outer kill/cleanup guards. Author worker
resourceLimits are unchanged. Claims precede launch; second launch depended on
the first meeting every frozen assertion.

* **No signal:** request rejected `WORK_DEADLINE` at **77.735708ms**; 12
  heartbeat ticks, maximum gap **6.392750ms**, termination **1.343334ms**.
* **Explicit abort:** delivered at **20.502959ms**, rejected the exact
  `REVIEW_INFLIGHT_ABORT` at **21.948042ms**, before the 75ms default timeout;
  three heartbeats, maximum gap **6.417917ms**, termination **1.285667ms**.
* At both request settlements, **before reviewer finally**, worker threadId=-1,
  created=terminated=1, requests=2 (init+scan), pending=false, capacityActive=0,
  signal listeners and worker transport listeners=0. No successful no-match
  was substituted for failure. execCalls=0 is the absence of a successful
  response counter, not proof no native execution occurred before termination.

This demonstrates responsive, default-no-signal containment on these fixed
inputs, **not a hard-deadline contract**, exact RSS limit, arbitrary-regex safety
certification, or general Node isolation guarantee.

## Dialects and bounded matcher comparison

Native direct/worker projections agree on the independent tiny captures,
Unicode fold and zero-width offsets. Current grep still uses Latin-1 byte
strings/BRE translation and g/gi; rg uses gu/giu, byte mapping, fragments and
tool-owned selection. Assertions on actual tools are kept separate from raw
UTF-16 facade expectations. In particular:

* `(r|rs)` on `rs` selects `r` natively but `rs` in byte Pattern. This
  predeclared difference passes as a preserved difference, not engine parity.
* Separate z/r descriptors on `rz` return z first and all hits in descriptor
  order. Actual grep -o prints r then z; actual rg combined alternatives select
  r first. Preserve command adapters rather than exposing generic order.
* Grep BRE numeric backreferences and POSIX classes remain accepted, special
  groups rejected. Actual rg still accepts named backreferences while rejecting
  numeric backreferences and lookbehind. No invented Rust/PCRE dialect.
* Rg's empty-pattern unterminated astral input enumerates four byte positions;
  generic gu empty matching advances by code point. Invalid-byte fragment anchor
  behavior and grep's word-filtered later match also passed actual tool checks.

Existing byte Pattern is useful only under an explicitly compatible requested
subset/profile, never a silent replacement justified by one contained stress
case. Its selection, Unicode and syntax/resource policies differ. No default
engine fallback or public API proposal is approved by this review.

## Benchmark fairness and resource policy

No reviewer benchmark run was needed or performed. The inspected 144 author
rows and report honestly disclaim a speed ranking. Their match-count gates
are valid for the six simple frozen inputs, and exact expected worker payload
sizes are checked. They do **not** establish equal full outputs/effects/capture
representations across all implementations. Current grep includes command
parsing/I/O and first-match count selection; current rg is only Matcher with
byte decoding; worker inputs are prepared before timing and collect captures
plus extra all-match termination calls; bounded Pattern uses byte strings.

For 10,000 short lines, worker16 sends **626** init+scan requests and worker128
**80**, both with **20,000** successful-batch native exec calls. Across profiles
those counts match; batch16 versus batch128 deliberately do not have equal
request counts. Current rg `calls` counts Matcher invocations, not native execs.
Startup and steady state are separated in the author report, and end-to-end
includes worker creation/disposal. Three repetitions rotate four engines but
do not fully balance order; cold-start/cohost-load effects remain uncontrolled.
The reported 10k-line worker end-to-end medians are roughly 46–59ms versus
current roughly 7–9ms on this host, not a performance win. Unicode preprocessing
and projection differences prohibit even a semantic-equivalent speed ratio.

Prototype caps are bounded but **not compatible defaults without owner policy**:

| Prototype restriction | Actual tool contrast |
| --- | --- |
| 16 descriptors / 64KiB aggregate JSON | rg allows 1,024 patterns, 8,192 UTF-8 bytes each; grep has no pattern-count cap and translated source cap is 65,536 code units, with -F exemption |
| 256KiB UTF-16 storage per batch | only 128Ki ASCII characters; grep default line collection is 32MiB bytes, rg default line limit 1MiB bytes |
| 4,096 hits / 64KiB serialized hits per batch | rg allows 100,000 matches per line; facade captures have additional payload overhead |
| 8MiB input storage / 4MiB result JSON per invocation | rg defaults to 64MiB input per file / 16MiB written output; units and scopes differ |
| 1,024 init+scan calls, 75ms/request, 3s active work | not current grep/rg contracts; smaller latency batches spend request budget faster |

Capacity contention is explicitly **fail-fast**, not queued: two clients sharing
the occupied host Capacity create zero workers and reject CAPACITY_BUSY; a
subsequent client succeeds once the holder closes. This bounds workers without
an unbounded queue, but sharing a single slot across concurrent pipeline
commands can reject otherwise valid pipelines. Root must choose a bounded
host concurrency policy and error semantics; this review does not demand an
unapproved global pool or merge independent command budgets.

Cheap aggregate string-length preflight before descriptor JSON serialization
remains advisable (author also identified this). Result validation and clone/
capture allocations are not an exact transient-memory bound. Child old-space
flags may override requested worker old-space; do not market effective 32MiB
or RSS containment. Huge inputs, natural OOM/stack exhaustion, compile timeout,
invocation call/input/output exhaustion, malformed-result range variants and
arbitrary source stalls were not added to this bounded cohort.

## Integration owner handoff and cleanup

The verified emitted worker graph is worker.js -> matching.js/protocol.js;
matching.js -> protocol.js, with **node:worker_threads transport as its sole
builtin import**. Source inspection found no subprocess, filesystem, network,
eval, Function construction or dynamic import in that graph. It adds no runtime
dependencies and accepts data descriptors, not host functions. Worker threads
still possess Node capabilities in general and are not a hostile-JS sandbox.

Required owner work, no assignments or edits made by this leaf:

1. Shared matcher owner: revise terminal cleanup and partial-batch live-stream
   policy, then independently retest the preserved failing repros. Keep static
   adjacent protocol/client/worker assets and per-invocation worker reuse.
2. Grep owner: `src/commands/grep.ts:48` translation/descriptor construction and
   `src/commands/grep.ts:54` word-filtered first/all matching/order; keep byte
   semantics and printing in the command. `src/commands/internal.ts:8` owns
   relevant input collection limits; do not silently reduce them.
3. Rg owner: `src/commands/search/matcher.ts:38` constructor/descriptor logic,
   fragment caches/anchors and byte mapping, plus
   `src/commands/search/rg.ts:32` asynchronous searchFile flow. Retain byte-empty,
   previous-end suppression, CRLF/NUL/binary/context and selection semantics;
   `src/commands/search/shared.ts:24` resource units remain tool-owned.
4. Root integration/build owner: approve new internal source paths and limit/
   concurrency policy. `tsconfig.build.json:1` currently emits only src to dist;
   test-only worker files are not product assets. A static `new URL` sibling
   worker.js under emitted dist is plausible, but verify it in an actual packed
   Node22 ESM consumer. `package.json:1` and `src/index.ts:1` remain exclusively
   root-owned; no root export change is assumed necessary or approved.

Validation was scoped: static Node syntax checks, isolated exact tsc build,
18 protected children, evidence/source/build identity audit, owned diff checks.
No full npm test/typecheck/build, published-consumer proof, provider run or
unrelated owner suite. Raw original failures, all claims/schedules, compiler
output, identity correction and audit are committed separately from the freeze.
`cleanup.mjs` verifies/removes only the exact 17 owned temporary emitted files;
`evidence/cleanup.json` records the now-absent directory. No PID search, process
group kill, author build deletion or unrelated native temporary cleanup.

**Do not rerun run.mjs risk; both reservations are spent.** Existing claim files
and schedules reject retries. This is a bounded prototype review, not full
regex/Node isolation certification, superiority evidence, a production approval,
or a claim to have worked 72 hours.
