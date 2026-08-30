# Independent filesystem type-contract timing diagnosis

## Initial verdict — August 30, 2026

**METADATA_ONLY_COMPLETE; CAUSE_UNESTABLISHED; EXCLUSIVE_CPU_GO_REQUIRED.**

Aquinas is the independent worker. No install, build, compiler, test, native
workflow, or runtime QA command ran during this phase. No source, test,
configuration, timeout, worker setting, assertion, or prerequisite was changed.
The publisher's failed full gate remains RED and publication is not approved.

The evidence supports a controlled, unchanged, exclusive full-suite experiment,
not an environmental-only diagnosis or an immediate speculative test rewrite.
Repeated compiler/library work is visible, but its contribution to the timeout
has not been measured independently of scheduling, GC, or filesystem/cache state.

## Pins and inspection scope

- Publisher candidate: `07f5abe79ec516f974392c19072f373239721016`, parent
  `860467821d390fab7da8095de9f7fec8b43055de`; local and unpushed in the supplied
  failure checkpoint. No publication or remote package claim is made here.
- Own freshly pulled main: `8bdd30a7c804e646fdf2c569bc6bdabd408f301c`. Its extra
  commit is documentation, not the publisher's Map candidate. Inspection uses
  exact `git show` source from the publisher pin, not a silently substituted gate.
- Root lock SHA-256:
  `3b2be4b2cd677d1094cb497cd174e09afdf1503e8d11b877065dfdf2bd778498`.
- Failing test SHA-256:
  `ba1de619d602179ece0c7008e64b8df6a8e1c4d9529ec4703d0c5cf62d28f0ea`.
- Root Vitest configuration SHA-256:
  `c914bb11c2922e83212cd354760615817c42c9c104c57a82ffbdd5ab8457f4dc`.
- Twelve exact source/configuration captures and their comparisons to pulled
  main are indexed in the capsule. Relevant publisher-installed TypeScript
  `5.9.3` and Vitest/runner `3.2.6` package metadata was read, not executed.
- Ancestor and root AGENTS were read. No original audit/archive payload, security
  payload, host probe, LLM, or other worker's source was investigated.

The initial clone inherited a historical local origin; its first pull did not
advance. Only the reviewer's origin was corrected to the publisher's official
origin, then an ordinary fast-forward pull reached the main pin above. No source
repair, branch creation, commit, push, reset, or author-checkout write occurred.

## Exact retained failure and control

The original checkpoint is copied byte-for-byte from:

`/Users/kjopek/Workspace/poe-code-safejs-publish/out/safejs-remediation/releases/mapset-callback-mutation/upstream-integration/full-gate-failure-checkpoint.json`

Its full-log SHA-256 was independently verified:

`fc6a2cbe4733a5b2765034cdb8030f984e452413f65d22994f865ee0812fd399`.

The full log records **26,544 passed, 1 failed, 41 skipped**, with 1,026 passing,
1 failing, and 3 skipped files. Duration is **447.19 seconds**. The command is
`env -u TERM SKIP_SYNC_SKILLS=1 npm_config_cache=<owned-cache> TURBO_FORCE=true npm test`.
The log confirms cache bypass, Turbo `2.9.18`, root `vitest run`, and Vitest `3.2.6`.
It is not a clean gate, and the independently retained history is never replaced
by a later result.

| Configuration                       | Composed 984-test gate |               Full root gate |
| ----------------------------------- | ---------------------: | ---------------------------: |
| NodeNext, Node-only                 |                1,413ms |                      2,826ms |
| NodeNext, DOM                       |                1,391ms |                      3,219ms |
| Bundler, Node-only                  |                  834ms |                      2,306ms |
| Bundler, DOM                        |                1,617ms | **5,969ms; 5,000ms timeout** |
| Whole filesystem type-contract file |                5,256ms |                     14,322ms |

The composed gate has 984 passes in 17 files, 19.78 seconds. It is not a full-suite
pass. The companion HTTP-header type-contract file similarly changes from
5,223ms to 9,022ms, but its four tests pass in both logs. This broader slowdown is
an observation, not proof of a single shared cause.

The checkpoint also reports 68 uncached builds, types, lint, formats, original
replays, and packed smoke green. Those are publisher-reported supporting gates;
this metadata-only review neither reruns nor freshly certifies them.

## Mechanism established by source inspection

`packages/safejs/src/modules/fs.type-contract.test.ts:54` registers four
synchronous tests: two module-resolution modes times Node-only/DOM library sets.
Each test batches **25** valid/invalid expressions into one virtual consumer:
**100** structural validity assertions overall, plus declaration-count and
unexpected-diagnostic checks. It does not launch 25 compilers per configuration.

The module reads `fs.ts` and extracts only `FsOperationName`, `FsImplementation`,
and `FsModuleOptions` AST declarations. The generated contract imports the
`node:fs/promises` types and safe-fs `FileSystem` interface. It does not execute
SafeJS, call Map/Set callbacks, or import the interpreter's implementation into
the compiler program. The Map candidate does not change this test, its extracted
declarations, the filesystem interface, the lock, or root test configuration.
That rules out direct source coupling through this test's inputs, not indirect
whole-suite resource or scheduling effects.

At lines 96–106 each configuration creates a new compiler host and program, then
calls `ts.getPreEmitDiagnostics`. Options include `strict: true`,
`skipLibCheck: false`, `noEmit: true`, ES2022, and `types: ["node"]`; DOM variants
add `lib.dom.d.ts`. The host creates SourceFiles from text for each request.
There is no old-program reuse or explicit shared parsed-library cache. No emit
or temporary file creation is requested by this test; its virtual files are
memory overlays while compiler inputs are read from disk.

`packages/tiny-mcp-client/src/http-headers.type-contract.test.ts` uses the same
four-configuration pattern, with nine examples and an additional
`exactOptionalPropertyTypes` setting. These are distinct coverage configurations,
not four identical assertions that may simply be deleted. Together the two files
perform eight independently created compiler programs. The older
`fs.option-surface.test.ts` also creates a compiler program during module
collection; its 4ms test-body duration therefore does not bound compiler cost.
Moving the failing work into collection or a hook would conceal cost, not fix it.

The installed runner's captured `chunk-hooks.js:1852` implementation wraps tests
with `withTimeout`. Besides a timer, it rejects completion when elapsed time is
at least the configured timeout. A synchronous compiler test can therefore fail
after 5,969ms even when a timer could not interrupt its synchronous body. The
observed timeout is not evidence of an unresolved Promise or an external request.
No compiler phase timings or assertion-completion trace are available to claim
which subphase consumed the time or that every assertion finished before failure.

Root defaults remain `pool: "threads"`, **`maxWorkers: 2`**, ordinary sequential
tests within each file, and no configured timeout override. `npm test` invokes
`turbo run test:unit --concurrency=1 --`; that Turbo setting does not mean one
Vitest worker. No worker-limit or timeout CLI option is present in the checkpoint.

## Resource chronology and its limits

The publisher logs give local start times rather than per-case UTC timestamps.
Using the supplied August 30 context and America/Chicago offset, the composed
gate is approximately **06:44:24–06:44:43.78Z**; the full Vitest gate is
approximately **06:48:55–06:56:22.19Z**. These are derived intervals, not invented
historical process receipts. The exact filesystem-test execution interval, CPU
time, memory/GC activity, and scheduler delay are absent.

Laplace's authenticated checkpoint SHA-256 is
`872fce7e59c75e19e2029bd8d2509e8456ae23fa8e4008ce07c2f3d159ac12a4`.
It records a concurrent full-root command **06:48:38.901–06:55:57.990Z**, overlapping
approximately 423 seconds of the publisher's derived full-suite interval. It
records last completion at **07:01:03.418Z** and no active owned commands. Its own
27,128-pass/1-fail/41-skip gate remains failed: the checkpoint describes a
checkout-nested temporary-location control that later passes outside checkout,
not this compiler timeout. This review does not waive or adjudicate that failure.

Helm's copied checkpoint records four completed child runtimes ending
**07:00:48.901Z**, with their known PIDs reaped. Its prior 6,425-test and 68-build
counts are recorded but this checkpoint lacks their exact start/end intervals;
they are not placed speculatively on the publisher timeline.

Root reports Dewey builds **06:50:49–06:52:02Z** and **06:54:35–06:55:50Z**, plus
types **06:53:52–06:54:00Z**: these overlap the derived publisher interval. These
are explicitly root-supplied timestamps, not independently authenticated command
receipts in this capsule. Dewey's later SafeJS failure is an obsolete array-lock
assertion, not this compiler failure. Root reports Dewey quiescent at 07:00:21Z.

At this checkpoint Nash/Sartre quiescence and explicit EXCLUSIVE CPU GO have not
been received. Concurrency is established at suite/process-interval granularity;
its causal share in the specific 5,969ms result is **not established**. Compiler
work, per-process cache/GC state, and concurrent work remain competing or combined
explanations. No host-wide process survey or performance probe was run.

## Controlled next phase — not executed

1. Root must supply all five quiescent checkpoints and explicitly grant
   **EXCLUSIVE CPU GO**. Installation/build preparation is heavy work too; no
   command in the following steps is authorized merely by this report.
2. Prepare an own clean projection of exact publisher commit
   `07f5abe79ec516f974392c19072f373239721016` using read-only `git archive` from the
   publisher repository. Record the tree, package/lock, test/config hashes, Node
   identity, and complete environment differences. Do not overlay newer main or
   modify the publisher. Keep captures outside test/config discovery paths.
3. After GO, install the exact lock with own cache and lifecycle safeguards
   (`SKIP_SYNC_SKILLS=1`, `HUSKY=0`, no home/live sync), and perform only required
   dependency/build preparation. Record exact commands and finish preparation
   before starting the measured gate. Do not share writable modules or caches.
4. Run **once**, without selection, retry, timeout, or worker overrides:

   ```sh
   env -u TERM SKIP_SYNC_SKILLS=1 npm_config_cache=<owned-cache> TURBO_FORCE=true npm test
   ```

   Preserve configured `maxWorkers: 2`, default 5,000ms, default include/exclude
   rules, and all assertions. Record exact cwd/environment, PID, UTC start/end,
   exit status, stdout/stderr, full-suite counts, and all four compiler-case
   durations. No private instrumentation, stress load, or parallel heavy work.

5. Preserve the original RED regardless of outcome. A clean exclusive run can
   support a scheduling-sensitive explanation and supply a new passing gate on
   that exact projection, but does not by itself prove CPU contention was the
   sole cause: fresh cache, process state, cwd, and machine history differ.
   Do not claim the original failing run was green or a later main was tested.
6. Any failure remains a gate failure, including unrelated temporary-location
   failures. Stop and route exact evidence to root rather than blindly retrying.
   If the unchanged test still exceeds its bound or remains intrinsically slow,
   assign a separate author a measured compiler-work reduction with genuine
   RED/GREEN coverage of all four configurations and all positive/negative
   examples. Do not move work into collection/hooks, skip library contracts,
   raise timeouts, reduce workers, or weaken assertions. Any proposed shared
   parsed-source reuse must retain per-configuration type checking and be
   independently reviewed; no such repair is authorized or proven necessary yet.

## Evidence and final initial-phase checkpoint

Capsule: `out/safejs-remediation/fs-type-timing-independent/initial-20260830/`.
Its manifest indexes source/configuration captures, original full and composed
logs, resource checkpoints, runner source/package identity envelopes, independent
inspection metadata, and this report. Package JSON files without final newlines
are captured as lossless base64 envelopes rather than silently changing bytes.

Metadata-only setup failures are retained: a search with no matches, an unmatched
optional config filename glob, and an initial byte-capture refusal for a package
JSON without a final newline. They caused no test or runtime execution. The
refused package capture was replaced by an explicitly classified lossless
envelope, not rewritten as an alleged exact text copy.

**QUIESCENT:** zero owned heavy commands started; zero active owned command
sessions at handoff. No CPU GO received. All this phase's shell/metadata children
finished normally except the disclosed metadata-command errors. Runtime verdict
and publication readiness remain pending; this is the completed initial
diagnosis/preparation handoff, not a final clean full-gate claim.

## Final controlled phase — unchanged gate passes

**CONTROLLED_EXACT_CANDIDATE_FULL_GATE_PASS; ROOT_CAUSE_NOT_PROVEN; CPU_RELEASED.**

This appendix supersedes only the initial phase's pending-execution status. Its
source analysis and preserved original RED remain valid. The initial report and
evidence are independently immutable: initial manifest SHA-256
`0d055ab4000e331fc182e42f49f1300d19f6ab78f3a89597aa87b5b419b10f83`,
23 indexed / 25 sealed files. The current report retains that initial text.

Root subsequently granted **EXCLUSIVE HEAVY CPU GO** after all five coordinated
workers became quiescent. Sartre's specifically allowlisted coordination
checkpoint was authenticated against SHA-256
`057448b548010059990f951935aa1c878a13ca23694d3e9d39844c737053097f`;
only that metadata file was read, not its other payloads. Root supplied Nash's
quiescence at 07:02:25Z and full-root interval 06:49:27–06:57:08Z, also overlapping
the publisher failure interval. Sartre's later Node22 full-root interval was
07:00:29–07:03:05Z. Their independent failures/qualifications are not adjudicated
or waived here. Exclusivity is among the coordinated workers, **not a claim that
the whole host or external user activity was idle**.

### Exact source and toolchain

The controlled projection is:

`/Users/kjopek/Workspace/poe-code-safejs-fs-type-timing-independent/.tmp/timing-exact-07f5`

It was created by read-only archive of publisher commit
`07f5abe79ec516f974392c19072f373239721016`, tree
`9e41ff16708c5d5d0842750f1fd26cd9503bde3b`. **All 4,022 tracked paths** matched
their Git blob identity after extraction, and their exact SHA-256 bytes remained
unchanged after installation/build and after the full gate. No newer-main
source, candidate overlay, test edit, or configuration adjustment was applied.
The failed-run lock, test, and Vitest configuration hashes listed above remain
exact. Source inventories include every tracked path, not just the failing test.

Actual execution used Node **v22.22.2**, npm **10.9.7**, TypeScript **5.9.3**,
Vitest/runner **3.2.6**, and Turbo **2.9.18**. Nine compiler/runner/package identity
checks matched the publisher's currently installed bytes, including
`typescript/lib/typescript.js`, ES2022/DOM library entrypoints, and the runner
timeout implementation. That current read-only comparison is not a recovered
historical process identity for the failed command.

`TERM` was unset. HOME, XDG cache/config, and npm cache were isolated under the
reviewer's owned work directory. `TMPDIR` was the separate outside-checkout
`/Users/kjopek/Workspace/.safejs-fs-type-timing-independent-tmp`.
`SKIP_SYNC_SKILLS=1`, `HUSKY=0`, snapshot playback/error mode, and the complete
nonsecret execution-environment subset are retained in `execution-identity.json`.
The original failure checkpoint does not record exact Node/npm, HOME, or TMPDIR;
these missing historical identities are explicit experimental limitations.

### Serial commands and complete results

All times below are **August 30, 2026 UTC**. Each exact command, cwd, allowed
environment, PID, exit status, signal, and full stdout/stderr is retained in its
own JSON receipt. There was no concurrent build/test within this worker.

| Command                                                | Start         | Finish        | Result                                                               |
| ------------------------------------------------------ | ------------- | ------------- | -------------------------------------------------------------------- |
| `npm ci`                                               | 07:11:02.524Z | 07:11:06.966Z | Exit 0; 549 packages added                                           |
| `npm run build`, `TURBO_FORCE=true`                    | 07:11:29.246Z | 07:11:54.239Z | Exit 0; 68 tasks, zero cached; root generation/types/bundle complete |
| Unchanged `npm test`, `TURBO_FORCE=true`, `TERM` unset | 07:12:56.269Z | 07:15:28.908Z | Exit 0; **26,545 passed, 41 skipped, zero failed**                   |

The full-gate invocation is exactly the planned `env -u TERM ... npm test` with
the concrete owned cache path retained in the command receipt. No worker
environment override was present. Root configured threads / **maxWorkers 2**,
the **5,000ms** test limit, original includes/excludes, and all assertions remained
unchanged. No name filter, retry, timeout increase, worker reduction, private
instrumentation, or skipped failing test was used.

The sole current full gate has **1,027 passing / 3 skipped files**, **26,586 total
tests**, **151.62s Vitest duration**, and **152.639s observed command wall time**.
It matches the original total test/file population; the previously failed test
now contributes the extra pass. Turbo reports one successful uncached root task.

| Filesystem compiler configuration |       Original full RED | Controlled full gate |
| --------------------------------- | ----------------------: | -------------------: |
| NodeNext, Node-only               |                 2,826ms |                659ms |
| NodeNext, DOM                     |                 3,219ms |                807ms |
| Bundler, Node-only                |                 2,306ms |                343ms |
| Bundler, DOM                      | **5,969ms / timed out** |   **559ms / passed** |
| Whole file                        |                14,322ms |              2,370ms |

The companion header file passes all four tests in 2,467ms, with variants
665 / 843 / 357 / 601ms. No compiler-case failure remains in this controlled run.
No additional focused suite or second full-suite run was performed.

### Causal disposition and remaining gates

The exact candidate satisfies the unchanged default full gate in this coordinated
exclusive window. The original full gate still failed. Together with the
authenticated overlapping worker intervals and source-independent compiler
workload, this result is **consistent with resource/scheduling sensitivity** and
supports prospective serialization of full gates as root's scheduling policy.
It does **not** establish CPU contention as the sole cause of the original
timeout: there is no per-case CPU/scheduler/GC profile, and installation/cache,
process history, cwd/TMPDIR, and unobserved host activity differ or are unknown.
No percentage of the 5,969ms is attributed to another worker.

There is no reproduced deterministic compiler timeout or newly confirmed source
defect requiring an author repair from this bounded experiment. Repeated
library checking remains an identified workload, but all four distinct contract
configurations now complete below one second individually. A speculative test
rewrite is not justified as a necessary publication fix by this evidence alone.
If root separately pursues compiler-work optimization or another unchanged gate
fails, use a separate author, preserve the full contract matrix and original
RED, and independently validate the root-cause change. Do not conceal work in
hooks or increase bounds.

The npm install reported **10 dependency advisories** (1 low, 1 moderate, 8 high)
and a deprecated-glob warning. They are retained, not investigated, fixed, or
claimed resolved. Publisher's other lint/types/packed/native gates are not fresh
independent results of this task; only the required build and this full suite
were rerun. No publication, npm release, future actual-main preimage, or other
worker's failing suite is certified by this snapshot. Root may return the CPU
window to the publisher for its normal pre-push gates on the required identity.

### Final CPU release and frozen evidence

Last owned heavy command finished **07:15:28.908Z**. At **07:15:59.406Z**, known
command PIDs **2962, 5803, 9888** were absent; a workspace-scoped PID query also
returned no matches. All owned execution sessions completed. No child was
killed, restarted, or given a revised deadline. **CPU RELEASED / QUIESCENT**;
remaining operations are only report formatting, metadata hashing, and sealing.
This is not a global host-idle assertion.

Final evidence is under
`out/safejs-remediation/fs-type-timing-independent/controlled-20260830/`.
The immutable final manifest links the immutable initial RED capsule, indexes all
current command outputs and source identities, and includes this report as the
sole new publication path with an absent-file preimage. The 4,022 publisher
source files are validated prerequisites, **not reviewer publication changes**.
All old captures remain intact. No production/test/README/SKILL/ledger or original
checkout edits, commits, pushes, or publisher writes were made.
