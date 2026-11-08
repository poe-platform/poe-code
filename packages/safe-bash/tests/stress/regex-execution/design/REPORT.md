# Bounded author prototype: results and handoff

**Recommendation: retain native matching behind an invocation-owned static
worker seam; do not replace grep/rg with the existing byte Pattern engine.**
This is a design direction for root approval, not a production patch or a
validated default contract. The worker contains pending native work while the
caller remains responsive in the measured probes. Startup and message costs
are real; profile adapters and resource-policy work remain before integration.

Only this new design directory is owned, excluding `review/`. No production,
public exports, package dependencies, other owners' files, or historical cohort
files changed. No delegation. No engine implementation. Initial source/freeze
commit: **4484026** (`test: freeze bounded regex worker design prototype`),
15 explicit paths, before the first probe. This report and actual evidence are
the separate atomic evidence commit: 188 additional explicit paths, 203 total
owned paths across the pair. Git supplies its final identity without
a self-referential amendment.

## Counts and source profile

Measured August 27, 2026 UTC: benign schedule at **04:49:48.220**, risky schedule
at **04:50:08.441**. These timestamps are actual short work, not a 72-hour claim.

* **178 child executions:** 175 benign and exactly 3 potentially pathological.
* Benign: 30 tiny tool/profile rows (24 accepted exact native/worker comparisons,
  six preserved tool rejections), one child containing 12 lifecycle/profile-edge
  cases, and 144 benchmark children (six inputs × two tool profiles × four
  implementations × three repetitions). No warmups or retries.
* **106 workers created / 106 awaited terminations.** No worker-per-line design;
  at most one worker in a child and one request in flight. All parent-observed
  children exited, disconnected, closed stdout/stderr and emitted child close.
* Failed children/vectors: **0**. Outer watchdog kills: **0**. Bounded-engine
  benchmark budget exhaustions: **0**. Expected worker deadline/abort/cap/errors
  are preserved as errors, not relabeled successful matches.
* Historical risky count: **7** (six `df4d05b` matrix runs plus the separate
  13-byte case). New author count: **3**. Cumulative: **10**. **Two probes remain
  reserved exclusively for the independent reviewer**, keeping the total ≤12.

Installed local profile: Node **v22.22.2**, V8 **12.4.254.21-node.39**, Darwin
arm64, TypeScript **5.9.3**, package **virtual-bash 0.0.0**, Node ≥22 ESM,
zero runtime dependencies. Initial live snapshot HEAD was
`866a6a58eb19d7a4271fb924ec4dd103c813d0a5`; unrelated concurrent dirty work is
recorded, not included in this patch. Frozen runtime closure: 13 product TS
modules plus four prototype TS modules; 197 source/compiler/declaration/config/
harness hashes and 17 emitted JS hashes. Isolated tsc succeeded and later
re-emitted all 17 JS files hash-identically (`rebuild.json`). No root dist build.

`frozen.json` SHA-256:
`57d963ca47556639de2471c4073b0a7625d8d4c3f7a1f2c1867d7a7824a90605`.
`source-bundle.json` SHA-256:
`933a8b7ec6787011723acf470d2de164f197a942b3838d2f870df117415a0381`.
The bundle retains exact prototype/test and consumed product TS text. Compiler,
package and Node/V8 metadata were captured before tests, not inferred later.
All frozen hashes were checked before/after each child and again by audit.
Fourteen paths overlap prior `d3f9e8d` source/config hashes: **zero drift**.
Other inspected, nonexecuted rg command/decoder/output/glob and sed/awk files
have explicitly post-run-only observations in `summary.json`; these are not
misrepresented as frozen execution coverage.

## Three fixed risky probes

All use `^(a+)+$`, 24 ASCII `a` bytes and `!` (25 bytes; worker string charge
50 UTF-16 bytes). Parent after-ready watchdog is **250ms**, outside the worker.
Worker init completed before risky ready; matching deadline is **75ms**.
Explicit cancellation is scheduled at **20ms**. No input growth and no native
parent-thread oracle. The existing Pattern also runs in the protected child.

| Probe | Outcome | Match-request through cleanup | Heartbeats / maximum gap | Awaited worker termination |
| --- | --- | --- | --- | --- |
| Existing Pattern, 10,000-step / 1MiB configured budget | completed, no match | 1.067ms | 0; completed before first beat | no worker |
| Native worker, **no signal supplied** | explicit `WORK_DEADLINE` error, no results | 76.560ms | 12 / 6.416ms | 1.071ms, exit 1 |
| Native worker, explicit abort | explicit `EXPLICIT_ABORT` error, no results | 21.338ms; abort delivered at 20.324ms | 3 / 6.412ms | 0.919ms, exit 1 |

No outer kill or timeout extension occurred. Both worker probes settled the
request, awaited the exact worker's termination, and removed matching/exit/
error listeners. The no-signal case demonstrates a prototype default work
deadline independent of a caller-provided signal. It does not establish a
hard real-time deadline: scheduling and termination add latency.

**Measurement limit:** the child records a before-batch entry and heartbeats,
not an instrumentation event from inside the worker's native `exec`. The exact
native instruction at termination is not observed. `metrics.execCalls: 0` in
these two terminated rows means **zero reported completed-batch call counts**,
not proof of zero executed RegExp calls. They show responsive cancellation of
in-flight worker matching; they do not certify an exact interruption point.
No extra probe was spent to improve that marker.

The current direct native baseline is reused, not rerun: `df4d05b` reports
grep N24 killed at 202.087ms and rg N24 at 201.712ms, both without timer delivery
inside the blocked child. Grep uses `g`; rg uses a noncapturing wrapper and `gu`.
These new worker risk rows use grep's `g` source only. Do not claim a new risky
rg worker measurement. Pattern's configured 10k budget is not its default 5M,
and this one completed case proves neither linear complexity nor universal
regex safety. The original report and fixtures remain unchanged.

## Exact small-vector evidence and engine gaps

The 24 accepted profile rows compare worker hits/captures exactly with direct
native execution inside the protected child and validate actual grep output
or actual rg Match byte spans. Captures preserve unmatched positions as null
in transport. Six rejected profile rows never construct that worker RegExp.
Grep flags are g/gi; rg flags gu/giu, with byte mapping checked on valid UTF-8.

| Case | Current native profile / worker descriptor | Existing byte Pattern |
| --- | --- | --- |
| `(a\|aa)` on `aa` | first `a`, then `a`; capture `a` | first/whole longest `aa`; capture `aa` |
| `(a)(b)?` on `a` | `[a,a,unmatched]` | corresponding capture values agree |
| `.` on 😀 | grep emits four original bytes separately; rg one four-byte span / two UTF-16 units | first byte only in its first-match result |
| `k` ignoring case on K | grep byte profile no match; rg Unicode folds and matches | byte profile no match, not rg-compatible |
| `(a)\1` on `aa` | grep accepted; rg numeric-reference rejection preserved | accepted closed numeric backreference |
| `(?<part>a)\k<part>` | grep special-group rejection; **current rg accepts named backreference** | rejected: quantifier without expression |
| `(?:a)` | grep rejects; rg accepts | rejects |
| `a(?=b)` | both tools reject; no worker compile for these profile rows | rejects |
| `[[:digit:]]` | grep translates and matches; rg rejects | byte class accepted |
| `^\|$`, `^$`, empty pattern, `a*` | tiny zero-width/empty cases agree with tested current profile | first-match behavior recorded, not rebased into a global-match oracle |

The literal `|` above denotes alternation, not an escaped operator in the
fixtures. `fixtures.mjs` is authoritative. Nested-positive `^(a+)+$` on four
`a` bytes, ASCII folding, optional captures and surrogate pairs also passed.
A lone surrogate is separately exact direct-native/worker **raw UTF-16 facade**
evidence, not a claim that an unpaired surrogate survives the tools' UTF-8
ingress. An extra current-rg check confirms empty pattern over 😀 produces
**five byte offsets**, and dot skips an invalid byte between `a` and `b`.
Those two behaviors require the existing rg adapters; raw generic Unicode
scanning is not equivalent. They were not silently called worker parity.

Static gaps beyond these vectors: Pattern treats escapes/classes/anchors,
byte case folding and capture preference differently, lacks JavaScript named
groups and Unicode properties, has different source/interval limits, and
charges steps synchronously. Its numeric backreference support is not Rust
regex parity. BRE translation must stay with its existing tool owner. The
prototype does not yet cover all grep word/whole/fixed/multiple-pattern/overlap
selection or rg fragment/CRLF/NUL/binary/context combinations end to end.

## Fixed benchmark cost observations

Three repetitions, engine order rotated by repetition, no warmup. Each row
uses a fresh test child; a worker implementation creates one fresh worker per
invocation, not per line. ASCII inputs are 64KiB of `a`; Unicode inputs are
32,768 `é` characters = 64KiB UTF-8. One/four fixed linear suffix patterns
`Z$`, `Y$`, `X$`, `W$` all yield zero matches. Short input is 1k/10k identical
`hit 123` records (8k/80k bytes including delimiters), exactly one match each.
Expected counts and worker serialized hit bytes were frozen before running.

All numbers are median milliseconds; raw three-value observations, min/max,
setup time, RSS, calls and bytes are retained in `summary.json` and per-child
evidence. Worker columns are **steady / invocation end-to-end**. Startup alone
across 72 benchmark workers: **20.929 / 21.617 / 24.203ms min/median/max**.
Termination across 106 workers: **0.531 / 0.942 / 1.466ms**.

| Workload/profile | Current end-to-end | Worker batch 16 steady / end-to-end | Worker batch 128 steady / end-to-end | Pattern end-to-end |
| --- | ---: | ---: | ---: | ---: |
| long-ascii-1/grep | 1.39 | 0.28 / 22.99 | 0.29 / 22.60 | 11.15 |
| long-ascii-1/rg | 0.38 | 0.31 / 23.77 | 0.37 / 24.32 | 11.49 |
| long-ascii-4/grep | 1.47 | 0.34 / 25.03 | 0.35 / 23.02 | 38.24 |
| long-ascii-4/rg | 0.46 | 0.31 / 23.34 | 0.32 / 23.92 | 39.07 |
| long-unicode-1/grep | 1.42 | 0.29 / 22.90 | 0.29 / 22.69 | 10.97 |
| long-unicode-1/rg | 6.85 | 0.30 / 23.53 | 0.31 / 24.00 | 11.14 |
| long-unicode-4/grep | 1.44 | 0.31 / 23.29 | 0.31 / 22.86 | 38.03 |
| long-unicode-4/rg | 6.92 | 0.31 / 22.93 | 0.28 / 23.05 | 38.20 |
| short-1000/grep | 2.15 | 5.29 / 27.86 | 3.98 / 27.22 | 2.68 |
| short-1000/rg | 1.51 | 5.29 / 27.82 | 3.72 / 26.26 | 2.62 |
| short-10000/grep | 9.28 | 35.11 / 58.52 | 22.86 / 46.40 | 9.64 |
| short-10000/rg | 7.33 | 35.20 / 57.92 | 23.08 / 45.66 | 10.31 |

**Not a speed ranking or equivalent whole-command benchmark.** Current grep
is the actual `grepCommands()` counting command, including parsing, input and
output; current rg is the actual Matcher including byte decoding, not rgCommand.
Worker descriptors/strings are prepared before timing, then worker startup,
compile, batches, serialized capture results and termination are measured.
Pattern uses original byte strings and a shared 5M-step / 1MiB configured
buffer budget. Its rows preserve every status; none exhausted here. All three
match-count projections agree on this deliberately simple cohort, but returned
representations/effects and profiles differ. In particular rg Unicode decoding
is not charged to worker timings. Do not infer an engine speedup, drop-in
compatibility or deployed throughput from these numbers. Cohost load is
uncontrolled, rotation is not fully balanced over three repetitions, and
startup/cold compilation costs are not amortized across separate commands.

| Worker records | Batch | Init + scan requests | Serialized hit bytes | Successful-batch native exec calls |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 16 | 64 | 53,063 | 2,000 |
| 1,000 | 128 | 9 | 53,008 | 2,000 |
| 10,000 | 16 | 626 | 530,625 | 20,000 |
| 10,000 | 128 | 80 | 530,079 | 20,000 |

These are identical for the two short-input profiles. One long row sends two
requests and four serialized hit bytes (`[[]]`); native exec calls are one for
combined rg or one/four for separate grep descriptors. Response byte counts
exclude the small protocol envelope. Current grep returns 2/5/6 count-output
bytes and makes 1-or-4/1k/10k observed regex calls; its first-match counting
path deliberately avoids the worker all-match null call. Current rg's `calls`
field counts Matcher invocations, **not native exec calls**. Pattern's counts
are find invocations. Current rg short results serialize to 21 bytes/record;
Pattern first-match results to 36; the worker capture projection to 53 plus
one array envelope per batch. These differences prohibit byte-equal speed claims.

## Lifecycle, resources, and remaining review blockers

Measured lifecycle cases: preabort with an invalid regex performs zero worker/
compile/match requests; empty source starts no worker; input cap rejects before
creation; result cap throws explicitly; invalid worker compile is relayed;
16-row batches stop upstream pulls while the consumer pauses; early return
closes the source and awaits termination; contention/inflight calls reject
without a queue; abort after posting settles; idle abort disposes; explicit
dispose settles a pending request; surrogate and rg adapter edges above.
All successful batches validate exact ID, result shape, ranges and serialized
size. Strict unhandled-rejection mode found no abandoned rejection in this
cohort. Protocol mutation, unexpected worker crash and natural resource-limit
exhaustion were **not fault-injected**; an invalid compile is a worker-reported
error, not an OS/runtime crash test.

Prototype caps and default-policy recommendation are in `DESIGN.md`. The 75ms
per-request and 3s active-work total apply even without a signal; 1,024 request,
8MiB input, 4MiB output and explicit one-slot capacity bounds accompany them.
Total-budget/call-budget exhaustion and compile timeout were not dynamically
exercised. Those defaults and tighter pattern/line/result caps are **not current
tool contracts**, and must not be silently imposed by a production patch.
Use explicit command errors, not empty results; existing output effects cannot
be rolled back on a later error.

All child flags: `--unhandled-rejections=strict --max-old-space-size=64
--stack-size=2048`. Worker execArgv is empty, env empty, and resourceLimits
requests old 32MiB / young 8MiB / stack 2MiB. Node documents process old-space
flag precedence, so **do not assert an effective 32MiB heap limit**. Sampled
child-process RSS min/median/max: **51.391 / 63.000 / 77.078MiB**, including
worker memory where present. RSS sampling and the 512MiB parent rejection
threshold are not an exact OS RSS cap; synchronous parent work can delay a
sample. Engine heap limits exclude external memory and do not prevent global
OOM. Captures/native compile and structured clones have transient allocations.

Two additional author-inspection cautions for review, without post-probe source
changes: descriptor validation measures JSON bytes after serializing the
descriptor array; a hostile host supplying a preexisting enormous source string
can cause avoidable allocation before rejection. Add a cheap aggregate UTF-16
length preflight before JSON encoding in an approved revision. No unbounded
source was supplied or executed here. Also, ready-idle external misuse without
awaited dispose is not automatically leased to a finite command lifetime;
production must keep client ownership within awaited command finally. Worker
threads are not a sandbox for arbitrary host JS; static pure matching code is
the trust boundary, with only message transport imported as a builtin.

Finite-input generator backpressure is measured, but its fill-to-batch policy
can wait for more records on a live stream. Production should flush at chunk
boundaries or bounded latency and preserve quiet/max-count/early-consumer-stop
behavior. An uncooperative source iterator is not forcibly cancellable.
Existing readBytes/writeBytes and signal propagation stay with the tool owner.
Raw facade changes for grep word-filter-before-selection, rg invalid fragments,
byte-empty rules and original result ordering remain integration blockers.

## Handoff, validation and cleanup

Proposed ownership, **no files assigned or edited outside this directory**:
shared internal matcher owner takes a small descriptor/protocol/client/static
worker sibling; grep/core owner retains translation, word/selection/printing;
rg owner retains decoder, fragments, Match byte mapping and searchFile control;
root integration owner alone approves resource defaults, package/build/assets
and any exports. A packed-consumer proof of emitted worker.js is still required.
No default host subprocess, global ambient worker pool or dependency is proposed.

Author validation: scoped tsc (17 modules), script syntax checks, 178 protected
child rows, `audit.mjs`, exact build reconstruction, owned diff checks. No broad
competing-owner suites, no external regex oracle, no production test/API claims.
All 183 raw evidence/claim/schedule files remain. `summary.json` is generated
from them without re-executing product code. `cleanup.mjs` verifies every owned
build-file hash before removing `.build/`; `cleanup.json` records 17 removed
files. Every observed child and worker is settled; no active owned child or
worker is left. No other native temp directory is touched.

Rebuild only: `node tests/stress/regex-execution/design/prepare.mjs --rebuild`
requires the same live consumed source/compiler/declaration closure, and rejects
different emitted hashes; exact frozen source text also remains in the bundle.
Audit after rebuilding: `node tests/stress/regex-execution/design/audit.mjs`.
Cleanup: `node tests/stress/regex-execution/design/cleanup.mjs`.
**Do not rerun `run.mjs risk`: all three author claims are spent.** Independent
review may consume only its two coordinated reserved probes; no reviewer
decision, full safety certification, parity, superiority or completion is claimed.

Primary technical reference (not installed-version evidence): Node v22.19.0
Worker threads documentation, `resourceLimits` and `worker.terminate()`:
https://nodejs.org/download/release/v22.19.0/docs/api/worker_threads.html .
Official Node search result retrieved August 27, 2026; prior static RESEARCH R4
also retains this reference. Initial latest-v22 open returned no content; this
was a documentation retrieval issue, not a safety refusal. No previously
blocked version-pinned TypeScript/CLI URL was fetched. No tool safety denial
occurred in the compilation or probe commands.
