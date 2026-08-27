# Bounded regex adapter / policy / package validation

2026-08-27. Owner: test-only validation leaf; decisionmaker: **ROOT**, not Curie.
Only new `tests/stress/regex-execution/design/validation/**` files were changed.
No product/public API/root/historical edits, installs, subagents, new engine,
or production pool. **Zero risky/pathological executions.** Historical risk12
was not rerun; author/reviewer/root reservations were not spent by this leaf.

## Result and exact denominators

Useful prototype evaluation completed, **not product integration approval**.

| Cohort | Observed result |
| --- | --- |
| Actual Shell command byte/status vectors | Original 21/22 equivalent; one owned adapter flag-spelling defect. Targeted correction recheck passes: effective 22/22. Original failure retained. |
| Raw capture vectors | 6/6; hand-written captures and complete synchronous/worker results agree. |
| Policy/liveness vectors | 5/5 expected observations: four positive demonstrations plus one negative idle-slot admission control. |
| Equivalent-work timings | 18/18 output-gated observations: two workloads × three engines × three ordered repetitions. |
| Packed/moved ESM consumer | 1/1 actual Node22 worker start, match, awaited cleanup. |
| Total | 33 unique vectors + 18 timing observations + 1 package proof = 52 planned jobs. 53 actual child executions including the one targeted recheck; 52 passing observations, one original failing observation retained. |
| Native baseline | 22 calls: 12 auxiliary BSD grep, 10 primary default-engine rg; **0 GNU grep calls, unavailable**. Original 21/22 expectation matches; corrected empty-rg fixture gives 22/22 expectation matches. Product/native stdout+status agree on 19/22, not full native parity. |
| Cleanup | All 53 exact child exit/disconnect/stdout-close/stderr-close lifecycles observed; 0 outer watchdog kills; no broad kill. 998 owned temporary files / 162 directories removed, both scratch roots absent. |

`evidence/audit.json` is the machine-checked summary. `run-17.json` retains the
failure, `run-recheck-17.json` the correction. No failed case was discarded,
reclassified as a pass, or replaced with a weaker byte assertion. Command gates
compare stdout **and stderr bytes**, not decoded-terminal strings, plus status.
Native agreement counts compare status/stdout; native diagnostic bytes are
retained but not claimed identical to virtual utility diagnostics.

## Frozen source, build, and deviations

Harness/expectation freeze: `026f72a6686da1c40c35540725a51a2ce23c8ec5`.
Isolated compiler-profile correction: `fb9c922884cd9d20f9848b980c1f78cea3a5c39b`.
Adapter/continuation correction: `da8ae9b`; audit/cleanup harness: `b4b196c`.
Author fixed source commit: `398143a253ada226340c05a8028add4df78d00ae`;
author evidence commit: `80f69f978657adc447ff77adb519770f3c8b078d`.
Author readiness was observed **before** final source copy, build, or matching.

Freeze timestamp: `2026-08-27T05:24:36.018Z`, HEAD `fb9c922...`, Darwin arm64,
Node `v22.22.2`, V8 `12.4.254.21-node.39`, libuv `1.51.0`, TypeScript `5.9.3`.
Strict NodeNext/ES2023 compilation uses local tooling and no runtime dependency.
The copied snapshot contains 177 source entries, 303 emitted files, and three
exact-anchor generated command/matcher copies. Source dirty state is retained
in `frozen.json`; this was not a clean whole-repository gate.

| Relevant source | SHA-256 |
| --- | --- |
| `design/client.ts` | `f2c5512b2785f146e68f3a335afd646ab74a3fdfa2370743151a05a7827044d5` |
| `design/worker.ts` | `39f40d5e17a64d375d7fdc9fa0cd76b74de3d701b046ae37020dd8a9f79c66a3` |
| `design/matching.ts` | `9af709988caef046f2b929ae2eaf005951cf311f2de8a24c32448b054691bef8` |
| `design/protocol.ts` | `baa928980f6623478ebae17c768cbb5319881e840686db943d0a0267d2ff098a` |
| `src/commands/grep.ts` | `5e5255a1cce15bfa57f1ba4ffd46e5b4ff7810c37aba8522fd50cdb482edba3d` |
| `src/commands/search/matcher.ts` | `499848186cde72bd696cba1fc7d53af39354ba74ea63c42acd92d5eb1cda1cfb` |

Original freeze SHA-256:
`55e16b071014d7bfed3266c846c4b585a8e07baa6c5f2d36f70f52461458b293`.
Continuation/repair manifest SHA-256:
`4053496d2f0e58fb3917cd9313d240069a2c000ee3e29a848a688b1f1349c1ac`.

Three harness/oracle defects are disclosed:

1. Initial isolated compiler omitted `lib: ["ES2023"]`, accidentally including
   DOM types and rejecting existing WebDAV `RequestInit.duplex`. `build-initial.json`
   retains the diagnostic. Correcting the harness to the repository profile
   compiled successfully; no WebDAV/product fix was made. The retained failed
   scratch tree was accidentally included in the broad harness hash census:
   485 of its 498 entries are failed-build artifacts, not 485 tests. They were
   verified then removed with owned cleanup, not counted as coverage.
2. JS reports flags canonically as `giu`, while this prototype protocol accepts
   `gui`. The test adapter initially forwarded `RegExp.flags` verbatim. Kelvin
   case-insensitive matching failed before worker startup. Canonicalizing the
   equivalent flag set in the owned adapter fixed that exact case. Source and
   emitted adapter hashes changed explicitly; all other 302 built files remained
   identical. The product, prototype, benchmark, and capture engine did not change.
3. After child 37, another owner's `src/commands/stream-inspection/README.md`
   changed; overbroad live-source verification stopped the schedule. No child
   was abandoned. Continuation used the unchanged copied snapshot, checked live
   grep/search/prototype identities, and completed only the remaining 14 jobs
   plus the Kelvin recheck. The precise unrelated drift is in `repair.json`.
   Benchmark order is preserved, but there is an interruption/cohost-load caveat.

Separately, the native baseline's initial empty-rg expected stdout was wrong:
for UTF-8 `é\n`, native rg emits three newline bytes, not empty output. Original
failure/input remain in `native.json`; expectations were corrected before the
main harness freeze, also supported by product byte-empty/Printer inspection.

## Native dialect evidence

Primary web sources and repository advertising are mapped in `DIALECTS.md`.
GNU manuals are documentation, **not** evidence that GNU grep was installed.
No blocked versioned Node22 TS/CLI documentation URLs were used; local runtime
metadata and actual compiled-worker execution establish the used Node features.

- Primary rg: `15.2.0 (rev e89fff89ac)`, PCRE2 compiled in but explicitly disabled
  for this profile by `--engine=default`; also `--no-config --color=never
  --no-heading --no-line-number --no-filename`, explicit stdin, `LC_ALL=C LANG=C`.
  Binary SHA-256 `4298efd414836892c913b2e87401d62fdd7c6ec4026d9bad8e3fab10557e411f`.
- Auxiliary `/usr/bin/grep`: `BSD grep, GNU compatible 2.6.0-FreeBSD`; not GNU.
  Binary SHA-256 `468ff46a0b9f0e88de268ce12640bfa37610d585f968127cf32cf4e86d5c70ab`.
  Exact per-case argv, inputs, stderr/stdout hex, version/help hashes and searched
  GNU locations are retained. Each call was capped at 2s / 64KiB output.

Three product/native differences are explicit, not hidden behind a parity claim:

| Case | Product / copied worker | Native | Decision implication |
| --- | --- | --- | --- |
| grep ERE alternation (the frozen `grep-ere-order` case), input `ab\n` | `a\n` | BSD `ab\n` | Product explicitly documents JS order, not full POSIX longest match. No silent engine-semantic change; obtain GNU evidence if proposing that change. |
| rg `\d`, input `١1\n` | `1\n` | `١\n1\n` | Documented JS-vs-Rust difference; preserve deliberate current contract unless root changes it. |
| rg `(?<letter>a)\k<letter>`, input `aa\n` | `aa\n`, status 0 | Empty stdout, status 2; exact parser error retained | Accidental acceptance contradicts advertised unsupported backreferences. Root may explicitly close this loophole with compatibility note/oracle test; no need to canonize an undocumented JS extension. |

## Equivalent-work table

These are **matcher/capture microbenchmarks**, not complete grep/rg command
throughput. Baseline runs the identical static `matching.ts` scanner synchronously
on current V8. It materializes the same captures, offsets, execution-call count,
and logical result bytes as the worker. The 22 actual command-copy gates are a
separate output test, not a claim that simplified matching timings equal full
product command costs.

| Workload | UTF-8 / UTF-16 input bytes | Rows / hits / capture values / exec calls | Selected bytes / canonical result bytes | Batch requests / stream requests, including init |
| --- | ---: | ---: | ---: | ---: |
| Long linear, eight 32,761-character records | 262,088 / 524,176 | 8 / 8 / 16 / 16 | 80 / 649 | 5 / 9 |
| Small many-line, 128 records | 1,938 / 3,876 | 128 / 128 / 384 / 256 | 2,066 / 10,174 | 5 / 129 |

Before every timed observation, full expected/current-worker logical results
must agree; outputs are checked again after timing. All nine observations per
workload have identical canonical-result and selected-output SHA-256 hashes
(in `audit.json`), not merely matching lengths. Stream protocol framing is
**not** byte-identical to batches: long hits serialize to 632 vs 628 bytes;
small hits to 10,276 vs 10,152. Logical byte/capture work is equivalent; extra
IPC/frame work is measured rather than concealed.

Milliseconds, median of three; work interval range in parentheses:

| Workload / engine | Work | Startup | Worker retirement |
| --- | ---: | ---: | ---: |
| Long / synchronous current V8 scanner | 0.019 (0.018–0.019) | 0.002 | n/a |
| Long / explicit worker batches | 0.491 (0.446–0.563) | 12.551 | 0.618 |
| Long / revised one-record stream | 1.066 (0.989–1.197) | 12.591 | 0.613 |
| Small / synchronous current V8 scanner | 0.109 (0.102–0.117) | 0.002 | n/a |
| Small / explicit worker batches | 0.726 (0.709–0.756) | 12.822 | 0.672 |
| Small / revised one-record stream | 3.115 (3.010–3.331) | 12.546 | 0.605 |

Stream work includes its automatic final retirement; the retirement column is
an overlapping component, not an extra additive duration. All timed worker
variants create **one worker per measured client**, not per record. Three-way
rotation was current/batch/stream, batch/stream/current, stream/current/batch.
No pathological timing was attempted. Startup and IPC dominate these tiny benign
tasks; these data do not demonstrate speed superiority or a calibrated timeout.

Additional timing limits: current scanner executes expected-result preflight in
its own isolate, whereas timed workers are newly created isolates after probes;
JIT/cache warmness is therefore not equalized. Very short times, only three
repetitions, the documented mid-cohort interruption, and concurrent host work
preclude a strong throughput ratio or steady-state claim. RSS samples are
after-work process observations, not peak RSS or a memory-performance cohort.

## Liveness and policy decision

The revised actual `Client.stream(source, 16)` returns each available row before
asking the live producer for its next row: 2 pulled / 2 delivered, one worker.
The adapter's bounded reusable-session request lease succeeds for a live
three-stage Shell pipeline with two record/ack cycles. Lease-free assertions run
at upstream production and during suspended final sink writes: 6 match requests,
2 workers, both retired. Three concurrent three-stage Shell pipelines complete
with exact `a\na\n` each: 18 requests, 2 reused workers, peak 5 waiters, peak 1
active lease, no idle workers after cleanup. This is not a worker-per-line design.

FIFO model confirms admitted finite jobs proceed in order. Original shared
prototype Capacity still returns `CAPACITY_BUSY` for a second ready client while
the first is idle: retained **negative policy evidence**, not acceptable product
behavior. Finite demonstrations are not a proof of starvation freedom or absence
of every possible cycle. Queue saturation/cancel-removal and uncooperative source
waits remain gaps; do not turn the model into a production scheduler by assertion.

Recommendation: use bounded request leasing, releasing before upstream/downstream
awaits; keep worker reuse and memory admission distinct. `POLICY.md` gives exact
proposed files/owners and internal API implications for ROOT. Proposed opt-in
experimental default with no caller signal: isolate compile/match, 1,000ms active
request / 3,000ms startup watchdog, **no implicit invocation-wide wall limit**.
Those candidates need root calibration/approval; current prototype 75ms/3s caps
are EXPERIMENTAL, not existing defaults. Preserve shared Shell budgets and tool
limits; prototype caps are materially smaller and cannot silently replace them.
Hard aggregate availability requires a separately approved shared time budget.

Fixed/literal fast paths are not shipped or universally proven. The Kelvin
`rg -Fi k` case demonstrates why ASCII lowercase/includes is not a general
Unicode-i substitute; Unicode word/boundary rules likewise remain explicit.
Workers are not a hard RSS/process isolation boundary. Static code and Node
resourceLimits do not prevent external-buffer growth or process-wide OOM.

## Isolated package proof

`npm pack --json --ignore-scripts --offline` on an isolated temporary manifest
produced nine entries: four compiled static JS modules, their declarations, and
the temporary package manifest. Archive size 4,630 bytes; unpacked 16,498 bytes.
SHA-256 `3d9fca52b87913301d86e3bea326fdbce2df8ea808db6c0092b818615955bd94`.
Extraction into a different `moved/node_modules/regex-validation-prototype`
directory preserved all eight module/declaration hashes. A separate Node22 child
loads consumer ESM with a bare package import; the client's sibling `worker.js`
starts, returns exact `a`/capture/offset results, and terminates with zero retained
client listeners. `run-51.json` and `package-build.json` retain evidence.

This proves **prototype packaging only**: no actual virtual-bash package export,
published bundle, installation integration, bundler support, Node version matrix,
real backend, SafeJS, or product command isolation is established. The temporary
manifest has zero runtime dependencies. Root package/exports/dist were untouched.

## Remaining gates and handoff

Root must decide dialect migration, no-signal timeout/overload defaults, aggregate
availability tradeoffs, queue/scheduler ownership, and public API necessity before
assigning integration. Internal synchronous matching would need awaited results;
the test copies still compile benign patterns on the child main thread and do
not prove isolated production compilation, complete caps, cancellation propagation,
all command flags, arbitrary multi-pattern sets, or general queue fairness.

No full npm suite or competing owner's suite was rerun. Checks actually run:
scoped JS syntax checks; isolated tsc (initial failure retained, corrected build
and adapter repair successful); 53 supervised benign children; 22 bounded native
calls; offline pack/moved import; evidence audit; owned cleanup; scoped diff check.
The 177-source snapshot and all emitted identities were checked before cleanup;
current source and original frozen snapshots are distinguished in repair evidence.

Reproduction requires fresh owned staging/evidence paths or deliberate archival:
do not rerun the no-overwrite native/run/repair outputs in place. Scratch builds
and temporary package were removed after audit. The sources, exact inputs,
expectations, source/build/package hashes, commands, failures, and evidence remain.
No just-bash superiority, universal native parity, catastrophic-regex safety,
full project completion, or 72-hour duration claim follows from this report.
