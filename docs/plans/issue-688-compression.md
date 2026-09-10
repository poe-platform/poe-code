# Issue 688: bounded bzip2, XZ, and Zstandard commands

Add `bzip2`/`bunzip2`/`bzcat`, `xz`/`unxz`/`xzcat`, and
`zstd`/`unzstd`/`zstdcat` to the byte-command family. All three formats need
compression and decompression, stdin/pipelines, `-d`, `-c`, `-k`, and virtual
file replacement with the existing compression family's source-preservation
rules. No native process or network codec fallback is permitted.
Preserve native defaults: bzip2 and xz remove successfully compressed input
unless `-k` is selected; zstd retains input by default.

## Implementation order

1. Reproduce all nine missing commands with focused tests.
2. Qualify the codec boundary before integrating it: bounded input and output
   steps, admitted codec memory, bounded synchronous work, cancellation between
   steps, cleanup, concatenated frames, and actual portable runtime loading.
3. Reuse the current compression stream and VFS staging machinery through
   format profiles. Keep gzip behavior covered by its existing tests.
4. Cover native fixture interoperability, binary/empty streams, file effects,
   corruption, truncation, hostile memory requirements, output limits,
   cancellation, and independent concurrent invocations.
5. Update maintained command inventories and test membership without rewriting
   sealed historical evidence. Verify built public consumers on Node, Bun,
   browser, and actual workerd; run appropriate maintained build/test/lint gates.
6. Commit owned paths, push main, verify release and published consumers, then
   close the issue.

## Feasibility findings

The existing byte command factory registers only gzip, gunzip, and zcat.
The existing gzip implementation already provides bounded byte chunks,
cooperative cancellation, private VFS staging, and output-consumer completion
checks. Its framing and filename rules are gzip-specific.

Initial library review rules out whole-buffer adapters. `compressjs` has
synchronous whole-stream entrypoints; its stream-shaped callbacks do not
provide asynchronous backpressure. The stock `compress-utils` streaming
wrapper drains and merges output synchronously. Its raw C bridge also needs
review of consumed-input reporting, concatenated-frame handling, and decoder
memory limits. Neither library is yet qualified for integration.

All nine command-availability tests fail against the current factory. An
isolated workerd probe using static compiled WASM modules roundtrips 64 KiB
through each of the three upstream codecs without Node compatibility. This
establishes a loading option, not production memory or CPU bounds. The ordinary
browser bundle currently requires no WASM module configuration, so an owned
bridge and generated JavaScript alternative are being evaluated before
changing the public packaging contract.

## Implemented candidate

The owned native bridge exposes consumed/produced counts and frame completion,
uses a 64 MiB allocation budget and a 128 MiB memory ceiling, and rejects
oversized decoder memory requirements. The generated JavaScript factories run
without runtime downloads, native processes, or dynamic WASM compilation. The
maintenance-only generator uses pinned sources and tools; repeated generation
produced identical hashes. Normal builds authenticate and copy the committed
artifacts, declarations, provenance manifest, and licenses into `dist`.

The streaming driver retains bounded input/output buffers, frame remainders,
XZ padding handling, backpressure, and cooperative cancellation. The existing
VFS staging and source identity checks remain shared. Native bzip2 output uses
periodic encoder flushing to bound sorting work; measured maximum calls in the
qualification cohort dropped from approximately 3.3 seconds to 233 ms. These
measurements are not a universal wall-clock guarantee. See
[the bridge evidence](issue-688-native-codec-bridge.md).

The 45 command checks pass, including embedded native fixtures and multi-file
streams. Independent native decoders accepted the produced empty and binary
streams for all three formats. Existing gzip cohorts passed 73 and 84 checks.
The build copy helper passed four in-memory checks for normal copying, complete
source admission, invalid inventories, and symlink refusal. The normal workspace
build and maintained safe-bash type route passed. Packed consumers passed 413
checks each in Node, Bun, browser, and workerd, plus three strict type consumers.
Repository-wide unit and lint gates and release verification remain outstanding.

The repository-wide unit run exposed three stale root/playground command
inventories. Updating the exact names and counts, with three actual playground
codec pipelines, passed all 82 focused checks. Two native Git cache tests and
one TypeScript header contract also failed in the shared run. Final diagnostics
confirmed five-second timeouts. The Git checks now prepare their independent
cache fixtures separately from the tested transitions, retaining five-second
bounds and every native operation and assertion. All four focused checks pass.
The header contract reuses TypeScript syntax trees through DocumentRegistry,
while independently checking all four compiler profiles with full library
checking and the same positive and negative cases. All four checks pass. The
previously failing profile measured 967 ms versus 2133 ms in a baseline run;
host contention limits the timing comparison. Independent review approved both
repairs; the repository-wide unit rerun remains required.

The complete lint traversal found an explicit throw in cleanup's finally block,
an unused test binding, and compiler-generated unused bindings and intentional
switch fallthrough. Cleanup now branches before closing, preserving original
failures and propagating cleanup errors on success; 39 focused safety checks
pass, including a cleanup-error identity control. A named configuration entry
turns off only no-unused-vars and no-fallthrough for the three exact generated
modules. They remain parsed and covered by every other rule. Generated bytes,
hashes, handwritten-code rules, and historical lint policies remain unchanged.

The next maintained unit run passed the shared stage (22,401 tests), then
exposed stale byte-family fixtures and inventory assertions. The lifecycle
suite had passed raw bytes to the six new decoders, preventing its sink tests
from reaching the sink. Native format-correct frames restore that coverage;
all 73 checks and strict types pass without late unhandled rejections. The
byte-plugin suite now checks the exact 23-command order and collision handling
for every command; all 48 focused checks pass. The full run remains in progress.

The source census rejected the generated zstd module at its ordinary 1 MiB
limit. It now admits only the three exact codec paths using the same manifest
size bound as the build copier (at most 4 MiB per artifact), exact byte length,
and SHA-256 verification. Manifest bytes are included in admission evidence and
must match their later source capture. Ordinary 1 MiB, aggregate 64 MiB, and
5,000-file limits remain unchanged. Four new in-memory controls and four existing
census checks pass; the originally failing authorization suite passes all 56
checks. Independent review approved the change.

Committed-package verification also pinned the build command from before asset
copying. Its current bootstrap now authenticates the exact copier alongside the
compiler, admits only the maintained command, and explicitly runs the copier
before capturing the dist baseline. Synthetic controls verify all eight copied
asset hashes, three actual build/pack consumer profiles, and refusal of missing,
changed, symlinked, or legacy build inputs before product source reads. All 191
archive controls pass. The completed broader run's 40 failures belong to the
repaired lifecycle, inventory, census, and build-verifier groups; a clean
maintained rerun is still required.

Integrated remote main's fixture repairs from `df24f8222`. The archive-permission
fixture retains the incoming immutable capability construction and explicit
absent-method overrides. New assertions reproduced six fallback failures before
restoring those overrides; all 12 cases then passed. The incoming isolated
Vitest fixture check passed, as did focused strict typechecking of the merged
permission fixture and new census helper/tests.

The next full run exposed a scheduling race in the existing no-output gzip
cancellation check: decoding could complete before a zero-delay timer became
eligible. A focused reproduction observed that completion on its first attempt.
The test now queues cancellation with `setImmediate`, preserving its task-yield,
exact cancellation identity, and no-output assertions and the existing deadline.
All 19 streaming checks pass; production behavior is unchanged.

The maintained type route also exposed exact-optional-property and TextDecoder
receiver type errors in two existing test files. Narrow corrections preserve
the fixture behavior and passed focused strict typechecking and runtime tests;
they are separate from the codec implementation.

Remote main advanced to `bf6f21440` with ZIP commands and retained filesystem
cleanup. The merge preserves both feature sets and resolves current command
inventories to 100 (101 with an additional custom command), retaining all nine
compression names and the ZIP pair. The raw-deflate addition preserves existing
gzip initialization and uses the separate portable driver unchanged. The normal
merged workspace build passed. Rebuilding corrected the first focused run's
stale 98-command playground outputs; all 128 root/playground and retained-cleanup
checks then passed. Full maintained unit/lint gates and publication remain required.
The seven focused Bash files passed all 194 checks, including exact default
registration and stream-inspection positions, canonical peer inventory, gzip
cancellation, raw-deflate framing, and invocation cleanup.

The merged full unit run reported two five-second timeouts in the portable XML
and YQ factory-identity checks (`/tmp/poe-688-zip-merged-full-unit.log`). Source
inspection found nine identical portable graph builds and seven complete
generated-artifact rewrite passes per test-file run. The existing `beforeAll`
now builds that graph and prepares its memory-only artifacts once. Every distinct
consumer build, fresh VM, graph/import assertion, factory-identity assertion,
runtime check, and existing hook/test deadline remains intact. Nothing is cached
across test-file runs. Focused validation is pending the current full run's
termination; that run's already-recorded failures are not treated as passes.

The next full run completed with one Bash failure: the native oracle for
`child Bash accepts short option` hit its unchanged 2-second spawn deadline
(`/tmp/poe-688-bundle-reuse-full-unit.log`). That fixture now supplies explicit
native argv to launch `/bin/bash +B -c` directly, removing the outer Bash whose
only job was launching that child. The virtual-shell source and literal child
body remain unchanged, as do native environment, byte/status comparisons,
output cap, and deadline. Other fixtures retain their parent-shell semantics.
One bounded native comparison confirmed identical nested/direct stdout bytes,
empty stderr, and status zero (`/tmp/poe-688-brace-native-direct-equivalence.log`).
The whole focused file passed 61 tests with its existing 13 unavailable-Bash-5
oracle skips, no failures (`/tmp/poe-688-brace-native-direct-green.log`). This is
not a timing improvement claim or a completed full gate.

The failed shared run was intentionally stopped after the two reported bundle
failures so the completed repair could be validated promptly. Its later stages
are not counted as passes. The focused bundle file then passed all 13 checks in
6.50 seconds (5.65 seconds of tests). Independent review confirmed private
read-only artifact reuse, unchanged initialization order and deadlines, and all
consumer/VM assertions retained. Host contention prevents an isolated timing
comparison with the earlier full-run measurements. A fresh full run is required.

Integrated remote main's `csplit` changes from `b270fe045`, preserving the nine
compression commands, ZIP pair, and the single-build portable test setup. Current
inventories contain 101 commands (102 with a custom registration); `csplit` is
last, matching the production composition, and stream-inspection positions remain
75 through 78. The merged normal build and all 113 focused root, playground,
bundle, and package-metadata checks passed. Full maintained lint/unit gates and
publication remain outstanding.
The eight focused Bash integration files passed all 294 checks, covering the
new command's public API and registration, current inventories and inspection
positions, canonical peer inventory, and bounded BRE search with its native worker.

The maintained lint passed on `f5358f19a` in 473.03 seconds, including all 10,588
configured files, root types, and workflows. The subsequent full unit run failed
in the shared phase: 906 files and 22,448 tests passed; one process-cleanup test
failed reading its PID file with ENOENT after the 250 ms command timeout. Two
existing skips remain skips. Evidence: `/tmp/poe-688-csplit-final-full-unit.log`.
Later workspace phases did not run. The test must establish real descendant
readiness before triggering the timeout; no production cleanup defect has been
established. Full gate completion and publication remain outstanding.

The repaired cleanup fixture captures the real shell's descendant PID on stdout
and confirms it is alive before advancing the initial timeout clock. It remains
alive at 249 ms and must be dead when the 250 ms timeout result resolves. Native
process events, escalation, and group-exit polling retain real timing. No PID
file or production change is needed. All eight focused command-runner tests and
strict TypeScript passed (`/tmp/poe-688-descendant-green.log` and
`/tmp/poe-688-descendant-types.log`); full validation must still complete.

The next maintained full run passed the shared phase (22,452 tests, two skips),
Bash runner (307 tests), parallel Bash phase (125 tests), and serial Bash phase
(28,302 passes, 86 skips, zero failures). SafeJS then failed: 21,656 tests passed,
37 skipped, two tests hit their unchanged five-second deadlines, and a dependent
completed-replay assertion lacked the result of one timed-out test. The failures
are the 128-draw completed replay and minimal-proof-2 Error projection cases.
Evidence: `/tmp/poe-688-readiness-full-unit.log`. Later workspace tasks and the
root posttest did not run. The complete route is not a pass; investigate the
confirmed timeouts without reducing scenarios, replay generations, assertions,
or increasing deadlines.

Profiling identified fresh-child transport/import work in the Error projection
fixture. Its source mode now builds the executable ESM child once, sends that
source on stdin, and sends the V8 request on fd 3. This removes repeated base64
transport of the 8.1 MB runtime while retaining a fresh Node process, both real
runtime restores, graph provenance, complete output flushing, and the existing
three-second inner/five-second outer deadlines. Built mode retains its public
package import. All 19 source and 19 built checks and focused strict TypeScript
passed. Source qualification took 21.16 seconds against the earlier 36.76-second
baseline; changing host load prevents a universal speedup claim. The completed
observation is assigned before assertions so a failed assertion cannot erase
the subsequent replay's input. Logs: `/tmp/poe-688-o12-raw-esm-green.log`,
`/tmp/poe-688-o12-built-green.log`, and `/tmp/poe-688-o12-types.log`.

The 128-draw profile instead found required fresh retained-graph accounting.
Duplicate-root removal, alternate guest array construction, and bulk descriptor
capture did not produce a safe measured improvement and were not applied.
The test now uses separate success and exact return-value assertions, avoiding
Vitest's duplicate subset comparison while strengthening equality. All widths,
three replay generations, four snapshot serializations, and host-call counts
remain. Eight focused tests and strict TypeScript passed; this small reduction
does not by itself establish that the full-run timeout is resolved. Evidence:
`/tmp/poe-688-completed-replay-green.log` and
`/tmp/poe-688-completed-replay-types.log`.

The maintained SafeJS workspace run after those changes passed both previously
failing files. It finished with 21,658 passes, 37 skips, and one different
five-second timeout: the PPR2 `co` scenario covering native trace, public/signal/
completed checkpoints, and recapture. Evidence:
`/tmp/poe-688-safejs-replay-workspace.log` (901.21 seconds). This remains a
failed workspace gate; inspect the confirmed case while retaining all scenarios
and sequential native/replay operations.

The PPR2 fixture now checks each original/resumed result's success flag once
and retains its existing exact return-value comparison, removing the preceding
duplicate subset comparison. Final recapture uses exact equality as well.
All seven sequential executions, native oracle checks, capture forms, replay
immutability checks, host-call assertions, and deadlines remain. All 19 focused
tests and strict TypeScript passed (`/tmp/poe-688-ppr2-green.log` and
`/tmp/poe-688-ppr2-types.log`). The `co` case measured 2.63 seconds versus 4.78
seconds in the preceding isolated run, but import timing also changed; this is
not an isolated causal timing comparison or a completed broad gate.

### Integration of GNU pr and cancellation fixes

Integrated origin/main at `2eb895778`, retaining all nine compression commands, ZIP, csplit and the incoming pr family. Current default inventories contain 102 commands (103 with an added custom command); frozen historical fixtures remain unchanged. Browser consumer checks retain the single portable build and artifact setup while adding pr entrypoint identity and runtime coverage. Incoming device acquisition cancellation and owned output drain changes and their tests are preserved.

The full unit route on `9934119eb` completed shared tests (907 passing files), Bash tests (28,302 passing, 86 skipped) and SafeJS (735 passing files, one failed, one skipped). The sole failure was the completed-input full workflow in `run.promise-aliases.test.ts`, exceeding its unchanged 5-second deadline. Profiling found its four partial comparisons consumed only 5.61 ms of 3397.8 ms (0.17%); no ineffective matcher change was made. Later workspace stages did not run because the maintained route stops on a failed workspace. Worker contention is being measured before choosing a correction.

The identical 57-case, three-file concurrency comparison passed with one worker in 40.58 seconds (slowest case 2389 ms), whereas two workers took 39.60 seconds and timed out both promise-alias and PPR2 cases (5124/5390 ms). Configure one worker only for the native `@poe-code/safe-js` npm task using its npm-provided package name; keep two workers for root/shared execution. Pool, test membership, hooks and deadlines remain unchanged. Avoid adding an unsupported CLI option that would invalidate workspace ownership discovery. Logs: `/tmp/poe-688-latency-workers1.log` and `/tmp/poe-688-latency-workers2.log`. This is measured latency improvement for the selected cohort, not a claimed full-suite throughput speedup.

Integration validation: normal `npm run build` passed including root suffix stages (`/tmp/poe-688-pr-merged-build.log`). Focused root/browser/workspace-ownership/device checks passed 147 tests in 14.05 seconds; all 24 changed Bash test files passed 1,037 tests in 30.80 seconds; standalone package metadata passed 21 tests. Logs: `/tmp/poe-688-pr-merge-root.log`, `/tmp/poe-688-pr-merge-bash.log`, `/tmp/poe-688-pr-merge-metadata.log`. Vite config loading confirms root two workers and native SafeJS one, both thread pools. Independent review approved the merge and configuration. Full unit and final lint remain required.

### Follow-up validation and tsort integration

The complete unit route on `3a801e3eb` passed 908 shared files (22,473 tests) and the Bash serial phase (28,582 passed, 86 skipped). SafeJS finished with 734 passing files, two failed files and one skipped file: five 5-second timeouts, comprising one three-element sort/flatMap case and four filesystem type-contract profiles. The earlier promise-alias, PPR2 and input-projection suites passed. Later workspace stages did not run. The host load average reached 105 during the new timeout burst, and neighboring unrelated cases slowed sharply.

Unchanged focused profiling passed all 202 array cases; the failed case took 33.68 ms, with 33.32 ms in runtime execution and 0.28 ms in checks. All four strict filesystem compiler profiles and all 25 expressions passed, with wall times of 0.93–2.10 seconds; semantic diagnostics consumed 69–84% and parsing 11–17%. No speculative code change was made. Evidence: `/tmp/poe-688-array-nested-profile.log`, `/tmp/poe-688-fs-type-profile.log`, `/tmp/poe-688-single-worker-full-unit.log`.

The final maintained lint attempt on that revision reached its unchanged 600-second supervisor limit without a report (`/tmp/poe-688-readiness-lint-result.json`); it did not pass.

Integrated origin/main at `e904602f1`: retain bounded tsort, bounded virtual character input support in pr, and the Toolcraft provenance availability repair. Current catalogs have 103 defaults/104 with a custom command; preserve all nine codecs, ZIP, csplit and pr, with tsort appended last. Frozen fixtures, inspection indices and portable browser setup reuse remain unchanged. Independent review approved the merge. Initial focused checks exposed a stale built browser bundle without tsort, so the normal build is being rerun before repeating those checks.

The existing PR workflow validates root/unit/lint on Ubuntu, runs the complete virtual-bash suite separately on Node22, and checks packed public APIs. A temporary validation branch and draft PR could avoid local contention, but requires an explicit user exception to the main-only branch instruction; none has been requested or granted yet. Local completion, remote delivery and release completion remain separate requirements.

Tsort integration validation completed: normal `npm run build` passed, refreshed root/browser/metadata checks passed all 115 tests (18.94 seconds), all 22 changed Bash files passed 847 tests (28.59 seconds), and `npm run lint:workflows` passed. Logs: `/tmp/poe-688-tsort-merged-build.log`, `/tmp/poe-688-tsort-merge-root-green.log`, `/tmp/poe-688-tsort-merge-bash.log`, `/tmp/poe-688-tsort-workflows.log`. The initial two browser inventory failures are recorded separately in `/tmp/poe-688-tsort-merge-root.log` and were resolved by the required rebuild. Full unit/lint qualification is still incomplete.

### Capture admission and lint cost investigation

The full maintained unit route on `ec098ec5c` passed 908 shared files (22,474 tests), the Bash runner tests and 125 parallel Bash tests. The serial Bash phase finished with 28,795 passed, one failed and 86 skipped in 1717.59 seconds. The sole failure was the refusal child returning null status in `writer-isolation/capture.test.ts:215`; its error/signal were not asserted, so the recorded result cannot establish whether it timed out or was otherwise terminated. SafeJS and later tasks did not run. Log: `/tmp/poe-688-tsort-full-unit.log`.

All six unchanged capture tests passed in isolation. A targeted regression demonstrated that invalid argv and repository-local temporary roots unnecessarily depended on loading capture-only modules: removing those modules from the existing disposable sandbox produced the wrong module-not-found error in both refusal cases. Move the two imports after the existing refusal checks; retain valid capture behavior, real subprocesses and the 5-second refusal deadline. Assert child error and signal to make future failures actionable. RED evidence: `/tmp/poe-688-capture-admission-red.log`.

A deliberately incomplete 500-file lint CPU profile took 26.15 seconds, including 5.30 seconds inside lintText. Native directory reads accounted for 14.67 seconds (56%), lstat 1.83 seconds and garbage collection 1.04 seconds. The guard's fresh directory observations dominate this sample; independent review found no established material optimization that preserves those observations. No speculative lint edit was made. Profile: `/tmp/poe-688-lint-sample.cpuprofile`; summary: `/tmp/poe-688-lint-profile.log`. This sample is not a lint gate and its intentional incomplete result is not a validation pass.

Capture GREEN: all six focused tests passed in 9.33 seconds (`/tmp/poe-688-capture-admission-green.log`), including both real success/corruption captures, artifact integrity checks and both rejection paths. The unchanged baseline took 11.97 seconds, but this is not an isolated causal benchmark. The latest full-run failure's exact cause remains unproven; the regression establishes and fixes unnecessary dependency loading before rejection.

### Complete Bash pass and spread fixture workload

The full maintained route on `f2af5a5b3` passed shared tests (908 files, 22,474 tests), the Bash runner and 125 parallel tests, and all serial Bash tests (28,796 passed, zero failed, 86 skipped; 1333.62 seconds). The capture regression passed in that full phase. SafeJS finished with 735 passing files, one failed file and one skipped file (21,658 passed, one failed, 37 skipped; 987.29 seconds). The sole failure was `interpreter.test.ts`'s large-argument spread worker exceeding its unchanged 5-second deadline at 5022 ms; later workspace tasks did not run. All earlier filesystem type-contract, array nesting, promise alias, PPR2 and input-projection failures passed. Log: `/tmp/poe-688-capture-full-unit.log`.

The revision's complete lint route passed all 10,620 configured files with zero errors/warnings, followed by TypeScript and actionlint, in 316.41 seconds (`/tmp/poe-688-readiness-lint.log`). This is not an isolated throughput comparison with earlier host loads.

After the full run was terminal, an external source-bound profiler compared the exact worker mechanism at three fixed stack/input pairs. Every pair proved that native `Reflect.apply(Array.prototype.push, [], source)` throws `RangeError` and that the real interpreter returns the exact length/first/last elements. The original 1 MiB/150,000 pair passed in 731.50 ms (400.01 ms interpretation), 0.5 MiB/75,000 in 426.21 ms (189.27 ms interpretation), and 0.75 MiB/110,000 in 487.47 ms (279.18 ms interpretation). The 7,447,909-byte bundle was identical across variants. These are diagnostic measurements, not relaxed test deadlines. Evidence: `/tmp/poe-688-spread-profiler.log`.

Use the 0.5 MiB/75,000 fixture to reproduce the same explicitly asserted native argument-limit failure with less interpreted work. Keep the fresh real interpreter worker, native failure assertion, exact result, 5-second deadline, cleanup, and separate array-length budget regression. All 477 interpreter tests passed in the focused Node22 run (3.48 seconds; spread case 352 ms), `/tmp/poe-688-spread-green.log`. Node20 verification and independent review follow before delivery.

Node20's first clean full-file attempt timed out in the same case at 5013 ms (476 other tests passed), so it was not treated as qualification. Timing inside real Vitest then passed the case in 610 ms: bundling 256 ms, worker online at 288 ms, result at 598 ms, interpretation 228 ms, cleanup complete at 605 ms. This did not identify the earlier delayed phase. All temporary instrumentation was removed. The final clean Node20 run passed all 477 tests in 5.65 seconds, with the spread case at 556 ms (`/tmp/poe-688-spread-node20-clean.log`); the failed and instrumented logs remain `/tmp/poe-688-spread-node20.log` and `/tmp/poe-688-spread-node20-profile.log`. Independent review approved semantic preservation and the unchanged budget/deadline assertions.

For remaining qualification, preserve the complete Node22 Bash result above and run all incoming/resolved Bash checks after the factor merge. Use the maintained Node20 `npm test -- --exclude-workspace=virtual-bash` route for root and every other declared workspace, including dependencies and native npm hooks. This matches the repository CI split and avoids repeating the unchanged 22-minute Bash phase. Report the prior full Bash revision, final focused merge checks, and final non-Bash route separately; do not call this a fresh all-workspace pass on the final merge.

### Factor and callback-admission integration

Integrated main at `73cdc99bc` (bounded GNU factor and PR/tsort callback-getter cancellation fixes). Prepared and independently reviewed all 19 conflict resolutions outside the tested checkout, then verified every source stage/blob and resolved-file hash before applying them. Retain all nine codecs and ZIP/csplit/pr/tsort; factor is appended last, with 104 defaults/105 custom commands. Historical 60/76 reconstructions and inspection 75/79 offsets remain unchanged. The browser fixture retains its single shared build/artifact setup and fresh consumer VMs.

The first normal build compiled successfully but failed three unchanged SafeJS fresh-process import checks with 5-second ETIMEDOUT results (`/tmp/poe-688-factor-build.log`). An empty native Node child subsequently started in 69 ms; all six unchanged import checks passed in 2.91 seconds (`/tmp/poe-688-factor-import-diagnostic.log`). No source defect was established and no import-test change was made. The subsequent complete normal `npm run build` passed all declared workspace builds and root schema/bundle stages (`/tmp/poe-688-factor-build-recheck.log`).

Final focused merge checks passed: all 38 changed/affected Bash files, including existing PR/tsort cohorts, passed 1,376 tests with no skips in 32.56 seconds; all three new getter-admission/factor TypeScript projects passed; root/browser/metadata/playground checks passed 116 tests across five files in 11.17 seconds. Logs: `/tmp/poe-688-factor-bash-focused.log`, `/tmp/poe-688-factor-types.log`, `/tmp/poe-688-factor-root-focused.log`. Final lint and the maintained non-Bash unit route remain outstanding.

Fresh published-consumer preparation retains all 414 prior checks and adds eight factor and eight PR/tsort cancellation checks (430 total), along with public factor type coverage and an installed-package compression demo. Runtime/browser/Worker checks and a newly viewed screenshot must use the actual released package; the prepared files are not release qualification.

The staged whitespace check reports a trailing blank line in three incoming files (`command-getter-admission/pr-tsort.test.ts`, `factor-independent/native-cases.ts`, and `factor-independent/review.test.ts`). Those files are preserved byte-for-byte from the incoming commit; the check is not recorded as passed.

Final lint on `8f7c117eb` passed all 10,637 configured files with zero errors/warnings, TypeScript and actionlint in 375.15 seconds (`/tmp/poe-688-readiness-lint.log`). The maintained Node20 non-Bash route then failed its shared phase: 901 passing files, seven failing files, 22,327 passing tests and 11 failing tests (248.01 seconds). Later workspace tasks did not run. Failures comprise process-launcher environment child output, Node20 browser fixture navigator availability, toolcraft test use of Array.fromAsync, and the real prepack lifecycle check. These are under targeted diagnosis; this route is not qualification. Log: `/tmp/poe-688-factor-node20-unit.log`.

Node20 fixture corrections preserve production behavior. Seven environment tests reproduced inherited NO_COLOR/FORCE_COLOR warnings triggered by console initialization; direct stdout JSON avoids that side effect without suppressing warnings or filtering output (10/10 focused tests pass). Browser bundles evaluated inside Node now receive lexical navigator.language in all four imports and both worker wrappers, with distinct sourceURL labels to prevent enormous data-URL stack traces. Toolcraft tests collect async streams with for-await instead of unavailable Array.fromAsync, preserving exhaustion, rejection and cleanup assertions (142/142 tests pass across five files, 14.91 seconds). Independent review approved those changes. The prepack control reproduced `sh: npm: command not found` because this Node20 installation has a broken npm symlink and the fixture sanitizes PATH; invoking the exact current Node and npm CLI preserves the real nested lifecycle (all five controls pass). Failure assertions now include unexpected child output. Logs: `/tmp/poe-688-node20-environment-red.log`, `/tmp/poe-688-node20-environment-green.log`, `/tmp/poe-688-node20-browser-stream-green.log`, `/tmp/poe-688-prepack-node20-red.log`, `/tmp/poe-688-prepack-node20-green.log`.

All eight changed test files pass targeted ESLint; maintained `npm run lint:types` passes, and the current diff passes whitespace checks. An additional ad-hoc strict compiler invocation on the lifecycle test failed because that standalone route lacks the existing JavaScript module declarations; it is not recorded as a pass and does not replace the maintained type check. Logs: `/tmp/poe-688-node20-fixture-eslint.log`, `/tmp/poe-688-node20-fixture-types.log`.

### Native-reference test runtime correction

On `e9a20d001`, the maintained Node20 non-Bash route passed 908 shared files (22,475 tests, two skipped; 228.49 seconds) and all 29 Python tests. SafeJS then exposed a source-bundle dependency error, multiple timeouts, and fast native-oracle failures. The source fixture externalized `#safe-js-platform` as an uncompiled `.ts` file; a single Node20 case reproduced `ERR_UNKNOWN_FILE_EXTENSION` in 959 ms (`/tmp/poe-688-node20-o12-diagnostic.log`). Keep resolved TypeScript modules inside the esbuild graph while preserving external runtime JavaScript dependencies and all original assertions/deadlines.

Further failures established that Node20 is not a suitable reference runtime for the current SafeJS test suite: it lacks native `Array.fromAsync` and `Promise.withResolvers`, used by tests to compute expected values before calling SafeJS. This does not establish that the product requires Node22. Independent review confirmed release workflows already use Node22. Move the PR main test job to Node22, retaining every native oracle and the separate complete Bash job. Workflow lint passes (`/tmp/poe-688-node22-workflow-lint.log`). This corrects the earlier choice to copy the stale Node20 CI runtime for local qualification.

After confirming the runtime mismatch, intentionally stopped only the owned Node20 route process groups; session 66392 ended with status 143 and all owned child processes were verified gone. Its SafeJS phase and later workspace stages are incomplete and are not passes. Preserve `/tmp/poe-688-node20-unit-green.log` despite its optimistic filename: only the shared and Python phases passed. Reported timeouts also occurred in camera, namespace, PPR2, completed/failure replay and function-arity controls while host load was around 33; contention is a hypothesis, not a demonstrated sole cause. Prepared bounded camera and namespace diagnostics retain original traces/replays/budgets and measure execution versus serialization/assertions before choosing any runtime optimization.

Bounded diagnostics completed on unchanged interpreter source under Node20. Both camera batches retained full native/recorded checks and passed: actual run 4301/3835 ms, comparisons approximately 1 ms each (five diagnostic cases; `/tmp/poe-688-camera-profile.log`). All five namespace cases retained original loops, replay counts, host calls and checkpoints: wall 3875/4227/2165/2559/2924 ms, with 97–98% inside run; dump/parse/restore contributed about 45–105 ms (`/tmp/poe-688-namespace-profile.log`). Source hashes were verified before and after. These measurements do not qualify the maintained five-second Vitest cases or prove the cause of earlier timeouts. They establish that removing assertions or serialization would provide little benefit; no speculative runtime/fixture optimization was made.

The O12 bundling correction passed all 19 original tests on Node20 in 32.36 seconds (`/tmp/poe-688-node20-o12-green.log`), retaining the maintained five-second per-case deadlines and complete source/native/provenance/replay assertions. Targeted ESLint, maintained `npm run lint:types`, workflow lint and current whitespace checks pass. Logs: `/tmp/poe-688-o12-eslint.log`, `/tmp/poe-688-o12-types.log`. Remaining qualification uses the maintained non-Bash route on Node22, preserving the earlier complete Bash revision plus final factor-focused Bash checks as separate evidence.

### Immediate native failure diagnostics

The maintained Node22 non-Bash run on `95a8c3373` passed shared tests (908 files, 22,475 tests, two skipped; 204.85 seconds), all 29 Python tests, and 735 SafeJS files (21,658 tests). SafeJS had one failed test and 37 skips in 1060.57 seconds: `string-split.independent.test.ts` reported an 18,508 ms case and the final error confirmed its five-second timeout. Every previous Node20 setup/API/camera/namespace/replay failure passed on Node22. Later workspace stages did not run. Log: `/tmp/poe-688-native-node22-unit.log`.

The exact split case passed separately in 106 ms; no source defect or root cause was established (`/tmp/poe-688-node22-split-diagnostic.log`). Native output withheld the actual error until the full suite ended, unlike existing shared-run diagnostics. Extract that existing reporter into one reusable module and select it through the root config using an absolute path, preserving native progress/final summaries and shared failures-only output. No test selection, workers, hooks, or deadlines change. The regression-first check failed with the missing reporter module (32 passing/one failing); applying the implementation passed all 33 reporter/environment/ownership controls in 256 ms. The actual focused runner also loaded the configured reporter successfully. Logs: `/tmp/poe-688-reporter-extract-red.log`, `/tmp/poe-688-reporter-extract-green.log`.

The unchanged complete split file passed all 808 tests in 15.17 seconds (12.85 seconds of tests), `/tmp/poe-688-node22-split-file.log`; this does not prove the earlier timeout cause. The native `opencode-poe-auth` package command passed all 27 tests in 465 ms, confirming that the root config's absolute reporter path also loads through an imported package config (`/tmp/poe-688-reporter-package-config.log`). Repository-wide lint and a final maintained unit route remain pending.
