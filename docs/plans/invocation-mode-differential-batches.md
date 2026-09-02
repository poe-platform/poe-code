# Invocation-mode differential batches

## September 2, 2026: scope and authorization

The isolated worktree is `/tmp/poe-invocation-batches-20260902`, detached at
`33593ea38`. The primary checkout remains untouched. Root owns delivery.

The qualified change groups the 57 differential rows into eight serial batches
of at most eight. The 15 host-control rows keep their existing individual child
protocol. Both native profiles, all 72 original observation names/assertions,
fixture IDs, case hashes and frozen evidence bytes remain unchanged.

The existing four-second process-group deadline and two-MiB combined output
ceiling apply to each batch. There are no retries or increased limits. A failed
batch fails its associated observations; success is never inferred from a
timeout. Group retirement and module/actual-load tracing are batch-scoped, not
per-row. Each differential row still creates a new MemoryFileSystem, registry,
Shell and fixture set, and must dispose its Shell before advancing. An existing
execution/fixture failure keeps precedence over a subsequent disposal failure;
a disposal-only failure fails the batch.

## Selection and current consumers

Keep the existing 72 top-level test names rather than adding batch parents.
On an unfiltered run, each explicit group holds only its in-flight/completed
child result for its own callbacks; every row executes once. Nothing persists
between test-file runs. The first callback in a group includes shared execution
time, so diagnostics must state the batch IDs and `sourceScope: batch`; later
callback durations are not independent execution timings.

When Node name/skip filtering is present, use the original singleton path and
let Node decide which unchanged top-level names execute. Do not implement a
second regex matcher or execute unselected rows speculatively. Validate both
separate and equals-form flags, combined filters, an unmatched filter and host
selection. If Node does not expose the selectors reliably, stop rather than
silently widening qualified selection.

`verify.ts` calls the unchanged singleton child protocol for its three baseline
rows and invokes the whole holdout for its holdout stage. `refresh.ts` also
invokes the whole holdout. These historical writers are not edited or rerun.
`trace.mjs` remains unchanged; actual loads within a shared process are not
claimed as independent loads for each row. The normal caller's native artifact
hash, accepted case hashes and profile/ID checks remain mandatory. Historical
receipts describe their old drivers, not validation of this new batching.

## Test-first preparation

Add cohort-local controls before changing the caller or child:

- Invalid batch sizes, duplicate/host/unknown IDs fail before any row execution.
- Every row has fresh MemoryFS, registry and Shell state, with disposal complete
  before the next row starts; a deliberately leaked marker must remain absent.
- Repeat/reverse runs execute again and reproduce singleton observations.
- Execution failure, falsey primary failures, fixture failure and disposal-only
  failure have the specified precedence and never advance/retry the batch.
- A late unhandled rejection still fails the isolated strict-mode child.

Register the new control file by its exact literal path in the existing discovery
test. Do not alter discovery rules, guard counts or receipts.

## Qualification sequence

Initial preparation did not run runtime tests or benchmarks. Root subsequently
authorized the red check, implementation and short co-loaded correctness checks.
Performance timing received a separate explicit grant after correctness passed.
The sequence below records the intended checks; completed results follow.

After root opens the window:

1. Prepare isolated dependencies/build inputs without modifying primary sources
   or rebuilding the primary. Authenticate the frozen native and case inputs.
2. Establish the red control result, then implement and run the focused controls,
   scoped typecheck and exact discovery registration. No raw ESLint.
3. Compare all 72 observations to the baseline and both frozen profiles. Verify
   23 child launches on a complete run (eight differential batches plus 15 host
   controls), with no additional batch-parent tests. Separately report controls.
4. Run selector and singleton-consumer checks. Reject reordered/missing/duplicate
   result IDs, body/observation drift, tampered native/case inputs, disposal and
   late-error mutations. Keep all mutation material outside tracked sources or
   restore only this worktree's own temporary edits before subsequent checks.
5. Verify source/fixture hashes before and after, batch-scoped actual load traces,
   child resource retirement, and the original hard deadline/output refusal.
6. Run the cohort A-B-B-A serially with identical tools and dependencies. Compare
   whole-file wall time and observation counts, including control-file overhead
   separately. No measured speedup is claimed before this sequence completes.

## Current status

The parent normal precommit rejected an explicit throw inside `finally`
(`no-unsafe-finally`, virtual-child.ts:56:34). The September 2 correction below
now passes focused requalification and fresh ABBA: **8.838069062 s net saving**
including nine-control overhead. Parent normal integration hooks remain required.
The earlier measurements remain evidence for the earlier helper, not this fix.
No production, shared harness, source-census, historical evidence, guard
or primary-checkout source changes. Delivery comprises the two driver files,
the new control file, one literal registration assertion and this plan. The
isolated node_modules symlink and copied build artifacts are dependencies only,
not delivery files.

### September 2 precommit correction: requalified

Only `virtual-child.ts`, this plan and subsequent handoff metadata are unfrozen.
The differential body now settles into an explicit success/failure outcome,
then disposes its Shell exactly once. A disposal error propagates only after
body success; otherwise the original body error (including false or undefined)
is rethrown after disposal. All propagation occurs outside `finally`; there is
no rule waiver, duplicate disposal, or change to row results, batching or hosts.
The existing nine TDD controls remain byte-identical and pass again, together
with the 72 observations, scoped types and refreshed mutation/source evidence.

During the root env-split timing window, only this static correction and plan
edit ran: no tests, build, lint or performance command. After root released that
window, `cleanup-fix-20260902/summary.json` records 9/9 controls, 72/72 observations,
clean scoped types, exact original names/full observations, 23 children and no
residual groups. Its mutation-summary.json records the same 49 expected failures
and 23 passes, all 72 diagnostics, eight full batch proofs and 49 references.
All 258 source hashes and protected cases/native/harness/trace hashes stay stable.
The corrected helper SHA-256 is
`3ac308ce3a94839c6bc94ccf7c534f4c2efc3fe70564bc025ce3b19ce866d78e`.

Fresh post-fix evidence is in
`/tmp/poe-invocation-batches-20260902-results/postfix-abba-2026-09-02T09-58-45.098Z`.
Root explicitly authorized one serial window of at most 120 seconds, accepted
cohort first and closure-v2 second, reporting no root heavy commands, Harvey
plan-only and other agents closed. Combined elapsed time was 62.524270834 s,
September 2, 09:58:45.098–09:59:47.622 UTC (04:58:45.098–04:59:47.622 CDT).
This is coordinated isolation, not an independent machine-wide idle audit.

| Post-fix run | Whole-file wall seconds | Observation passes | Children |
| --- | ---: | ---: | ---: |
| A1 | 14.515016750 | 72 | 72 |
| B1 | 4.933810708 | 72 | 23 |
| B2 | 4.984612334 | 72 | 23 |
| A2 | 14.490254500 | 72 | 72 |
| Separate controls | 0.705355042 | 9 additional controls | Outside original cohort |

Original mean 14.502635625 s; corrected mean 4.959211521 s; gross saving
9.543424104 s; **net saving 8.838069062 s** after the separate nine-control run.
Every run preserved exact names and complete observation objects, including the
rendered fixtures, against the earlier successful baseline. Both native-profile
assertion sets ran unchanged. A/B used identical Node v22.23.2 commands and a
pass-through NDJSON reporter, with no observation preload for this cohort.
Sources, fixed controls and protected inputs were authenticated before/after
runs and state switches; all groups retired and neither resource cap fired.
The corrected B caller/helper were restored and authenticated in `finally`.
CPU release and both cohorts' short results preceded this documentation update.

Corrected handoff lives under
`/tmp/poe-invocation-batches-20260902-results/cleanup-fix-20260902`:
`invocation-mode-cleanup-fix.patch` updates only helper/plan from the previously
accepted staged candidate; `invocation-mode-batches-fixed.patch` contains the
complete five-file change from the original base; `fixed-manifest.json` binds
all five current files and both newline-terminated patches. Fresh driver-hashes.json
and select-A.patch/select-B.patch also live there. Older top-level manifests,
patches and ABBA records stay unchanged as prior qualification evidence and must
not be used as the corrected handoff. Primary/staged files were not edited here.

### Completed correctness checks

Evidence is in `/tmp/poe-invocation-batches-20260902-results`:

- `red.tap`: the unchanged child rejects the new import because `differential`
  is not exported. The initial shell status-capture wrapper also encountered
  zsh's readonly `status` variable; the retained TAP independently records the
  intended module-load failure and exit 1. Subsequent wrappers use `result`.
- `controls-first.tap`: nine controls pass, covering admission, fresh state,
  repeat/reverse execution, primary/falsey/disposal/fixture failures and strict
  late-rejection failure. No original test or assertion was deleted.
- `types.log`: focused strict NodeNext typecheck passes for both drivers and
  the new control file.
- `current.ndjson`, `current-summary.json`, `current-loads.txt`: all 72 original
  observations pass both frozen-profile assertions. Exactly 23 child PIDs are
  observed: eight differential groups of 8/8/8/8/8/8/8/1 and 15 singleton host
  controls. Every differential ID appears once in actual child output. All 258
  source hashes remain stable; actual tracing records 53 TypeScript source
  paths including runtime.ts. No child process group remains alive afterward.
- `selectors-and-consumers.json`: separate/equals/combined name and skip flags,
  host selection and an unmatched filter execute exactly the expected IDs and
  singleton child counts. The three direct-child requests used by verify.ts
  retain their original output shape and match both native profiles. Historical
  verification writers themselves were not executed.
- `protocol-mutations.ndjson`, `mutation-summary.json`: in isolated control
  processes, transformed child responses omit/duplicate/reorder IDs, corrupt
  exact stdout or mislabel scope. They produce exactly 33 expected failures and
  39 passes while all 72 observations still execute through 23 children. Separate
  read-result mutations of the native artifact and cases.ts are refused by the
  existing hash assertions. No frozen file was rewritten for these controls.
- `bounds-controls.json`: a synchronous hang in the second actual row is killed
  by the unchanged four-second batch deadline (observed return 4007 ms), and
  output exceeding two MiB is refused. Both controls leave no live group.
- `discovery.tap`: the exact new control path is discovered by the maintained
  runner. There are 72 unchanged top-level observation tests, no batch parents,
  and nine additional controls in their separate file.

These are correctness results, not measured speedup. CPU was explicitly released
before this documentation update. No raw/root ESLint, commits or pushes ran.

### Driver identity

`driver-hashes.json` and the prepared `select-A.patch` / `select-B.patch` bind the
two owned drivers used by the completed ABBA sequence:

| Driver | Original SHA-256 | Candidate SHA-256 |
| --- | --- | --- |
| holdout.test.ts | ba1a9c461822a81fa99193ad3aa04bf1382cf0bb567d2e4569d5f67c93ac5d02 | a9cbbf322ad954d2635459de8fa8ee6dad95ca20df3b69966f2019f9f0320545 |
| virtual-child.ts | c5d770ba6ba0522e0387fbcbdd0dd00c9437ae3520ae593aeaf1546be604781d | 639dc722fe4bd5c8b837318fb260eff4a082db082dd9c1b3e6396ec61ad6bef6 |

cases.ts remains `fdc22c27541f4f29334274e35238c22fa4645730dbe5239134a585ee8e03f83c`;
native-corrected-evidence.json remains
`86e6be4ec1ad22f3c5956ed0b37d8091653c4858fbf143f35b2e80eae4b67e45`.
harness.ts and trace.mjs also retain their original bytes. The new implementation
does not claim per-row module isolation or per-row actual-load authentication.

### September 2 receipt-output correction

`receipt-red.json` records the original candidate's duplicated output: 57 full
batch receipts rather than eight. The corrected caller keeps all 72 diagnostic
lines and observation names, but emits each full differential child receipt only
in its first callback. The other 49 callbacks reference that receipt and PID.
Successful differential callbacks include an explicitly labelled `row-json`
transport containing their individual observation; filtered singleton and host
receipts retain the original child transport.

`receipt-green-summary.json` qualifies 72 passes, eight full batch receipts,
49 references, 15 full host receipts, exact complete observation equality with
the preceding run and no residual groups. Diagnostic bytes fall from 463851 to
120899; this is an output-size result, not a runtime benchmark. The literal
`compare-frozen.ts` decoding expression recovers all 72 original IDs from these
diagnostics. This qualifies that transport contract only, not execution or
current source-seal qualification of the historical refresh/verification tools.
Those tools and their evidence remain unchanged and were not executed.

`receipt-failures-summary.json` records 49 expected failures and 23 passes after
isolated response mutations: omitted/duplicate/reordered rows, invalid JSON,
incorrect scope, corrupted stdout bytes and nonzero child status. All 72
diagnostics remain; full raw stdout/stderr, their hex values, argv and failed
status are retained once per batch, with every later reference resolving to that
proof. No frozen bytes are modified. `receipt-singleton-summary.json` verifies
one selected row still launches the original singleton protocol and full receipt.
`receipt-controls.tap` passes all nine controls; `receipt-types.log` is clean.
The A/B patches and driver identities above are refreshed for this correction.
Final ABBA subsequently ran under the explicit grant recorded below.

## Final ABBA and handoff: September 2, 2026

Evidence directory:
`/tmp/poe-invocation-batches-20260902-results/final-abba-2026-09-02T09-21-38.635Z`.
`summary.json` records the complete sequence from 09:21:38.639 to 09:22:18.418 UTC
(04:21:38.639 to 04:22:18.418 CDT). Root granted exclusive coordinated timing,
reported no root heavy commands would start before release, and reported Harvey
idle since 09:19:40.812 UTC with the other agent read-only/static. These are
coordination statements, not a machine-wide idle-process measurement.

| Run | Whole-file wall seconds | Original observations passed | Child processes |
| --- | ---: | ---: | ---: |
| A1 | 14.434882458 | 72 | 72 |
| B1 | 5.006473166 | 72 | 23 |
| B2 | 4.969249375 | 72 | 23 |
| A2 | 14.058743208 | 72 | 72 |
| B controls, separate file | 0.662276000 | 9 added controls | Not part of the 72-row cohort |

Original mean: 14.246812833 s. Candidate mean: 4.9878612705 s.
Gross saving: 9.2589515625 s. Subtracting the separately measured nine-control
file gives **8.5966755625 s net saving** per complete cohort plus controls.
No new batch parents exist: canonical coverage is the unchanged 72 observation
tests plus nine new controls, not 81 original observations. These are local
cohort results, not a prediction or qualification of full CI/release duration.

The actual runner used Node v22.23.2, `spawnSync` and `performance.now()` around
each complete Node child, rather than the preparatory `/usr/bin/time` example
below. Every run used identical `--import tsx --test --test-concurrency=1` flags
and the same pass-through NDJSON event reporter, without selector filters.
The exact argv, exit status and duration are in each `*.run.json`; complete
event streams are in A1/B1/B2/A2.ndjson and controls.ndjson. Each run exited zero.
Hash checks and observation comparisons occurred outside the timed child.
No build, lint, concurrency change or retry was introduced.

All four runs had identical ordered test names and complete decoded observation
objects, including rendered fixtures, output bytes, statuses and filesystem
effects. `observations.json` retains the common 72 objects. A decodes the original
single-row child receipt; B decodes the explicit row-json observation, verifies
it against the actual batch output and resolves every later receipt reference.
B executed each of the 57 differential IDs once in batches 8/8/8/8/8/8/8/1;
all 15 original host controls remained individual children. Both native-profile
assertion sets ran in every variant. Source inventories before/after contain
the same 258 paths and SHA-256 values, rechecked between every state/run.
Both driver identities matched the table at every switch; cases, native evidence,
shared harness and trace hashes matched the protected pre-existing identities.
All observed groups were absent after each run; none timed out or exceeded output.
The candidate was restored and authenticated in `finally` before CPU release.

The receipt correction reduces the intermediate duplicated-batch payload from
463851 to 120899 bytes (342952 fewer bytes); it is not a reduction versus the
original singleton caller. Final ABBA measured A1/A2 diagnostics at 104804/104763
bytes and B1/B2 at 120827/120834 bytes. B retains extra explicit batch provenance
and individual observation transport while avoiding eight copies of whole-child
proof. Small serialized timing/PID differences explain varying receipt lengths.
All original assertions and full failure proof remain, with selector, mutation,
disposal, late-error and hard-resource controls documented above. Authentication
and process/module isolation are explicitly batch-scoped, not per-row; fresh
per-row runtime/FS does not imply an independent module load or child watchdog.
The four-second/two-MiB bound applies to each whole batch, without resetting.

Historical writers, source seals and receipts remain byte-unchanged. Their old
qualification is not reinterpreted as validation of this implementation. The
legacy 72-line observation decoding contract was checked, not the complete
historical refresh/compare-frozen workflow or its old source bindings.

Handoff is the newline-terminated, relative-path unified patch
`/tmp/poe-invocation-batches-20260902-results/invocation-mode-batches-final.patch`.
`invocation-mode-batches-final-manifest.json` beside it records all five final
file hashes and the patch hash. It contains only:

1. `packages/safe-bash/tests/shell-stress/invocation-modes/holdout.test.ts`
2. `packages/safe-bash/tests/shell-stress/invocation-modes/virtual-child.ts`
3. `packages/safe-bash/tests/shell-stress/invocation-modes/batch-controls.test.ts`
4. `packages/safe-bash/scripts/integration-inputs.test.mjs`
5. `docs/plans/invocation-mode-differential-batches.md`

The shared registration edit adds only the exact new control-file assertion;
parent integration must preserve any newer surrounding runner changes rather
than replace that file. Dependencies, symlink, generated dist and temporary
evidence are not patch members. Primary remains untouched by this worker.
CPU release and the measured result were reported immediately after commands
finished, before this static plan/patch handoff. No further runtime checks are
requested; parent owns normal integration hooks, commit and delivery.

## Preparatory commands retained for provenance

The isolated worktree now links the already-installed node_modules and has local
copies of safe-fs/dist and safe-js/dist. No build was executed. Pin all runtime
commands to the same existing Node 22.23.2 binary. Authenticate these dependencies
again if the parent reports a runtime-artifact change.

### Window 1: red control only (estimated 2–5 seconds)

```sh
cd /tmp/poe-invocation-batches-20260902/packages/safe-bash
NODE=/tmp/poe-test-graph-full-20260901/node-runtime/node-v22.23.2-darwin-arm64/bin/node
RUN=/tmp/poe-invocation-batches-20260902-results
mkdir -p "$RUN"
"$NODE" --import tsx --test --test-concurrency=1 \
  tests/shell-stress/invocation-modes/batch-controls.test.ts \
  >"$RUN/red.tap" 2>&1
printf '%s\n' "$?" >"$RUN/red.status"
```

The qualifying red result must be the missing new child export/protocol, not a
dependency or loader failure. Immediately report the result and release CPU.
Implementation and preparation of reversible A/B patches happen outside the
reservation. Do not hold a timing window while editing code or this plan.

### Prepared ABBA window (estimated 45–60 seconds)

Use the same NODE, RUN and package working directory. Exact `select-A.patch`
and `select-B.patch` files are now prepared for only the two owned caller/child
changes; A restores their original bytes and B restores the candidate. The new
controls and registration remain present in both states, but are not part of
the original 72-row timed file. The correctness commands below have passed;
they do not require repetition just to occupy the timing reservation.

```sh
"$NODE" --import tsx --test --test-concurrency=1 \
  tests/shell-stress/invocation-modes/batch-controls.test.ts \
  >"$RUN/controls.tap" 2>&1
"$NODE" --import tsx --test --test-concurrency=1 \
  --test-name-pattern='^default normal runner passes every discovered active file to serial Node execution$' \
  scripts/integration-inputs.test.mjs >"$RUN/discovery.tap" 2>&1
"$NODE" ../../node_modules/typescript/bin/tsc --noEmit --strict \
  --exactOptionalPropertyTypes --noUncheckedIndexedAccess --skipLibCheck \
  --module NodeNext --moduleResolution NodeNext --target ES2023 --types node \
  --typeRoots ../../node_modules/@types \
  tests/shell-stress/invocation-modes/holdout.test.ts \
  tests/shell-stress/invocation-modes/virtual-child.ts \
  tests/shell-stress/invocation-modes/batch-controls.test.ts \
  >"$RUN/types.log" 2>&1
```

Selector checks use the unchanged literal names and must check actual executed
IDs/child launches, not only exit status:

```sh
"$NODE" --import tsx --test --test-concurrency=1 \
  --test-name-pattern '^invocation differential: bash-c-empty$' \
  tests/shell-stress/invocation-modes/holdout.test.ts >"$RUN/filter-separate.tap" 2>&1
"$NODE" --import tsx --test --test-concurrency=1 \
  '--test-name-pattern=^invocation differential: (bash-c-empty|bash-c-name-omitted)$' \
  '--test-skip-pattern=^invocation differential: bash-c-name-omitted$' \
  tests/shell-stress/invocation-modes/holdout.test.ts >"$RUN/filter-combined.tap" 2>&1
"$NODE" --import tsx --test --test-concurrency=1 \
  '--test-name-pattern=^invocation host boundary: host-origin-default-and-replacement$' \
  tests/shell-stress/invocation-modes/holdout.test.ts >"$RUN/filter-host.tap" 2>&1
"$NODE" --import tsx --test --test-concurrency=1 \
  '--test-name-pattern=^no-such-invocation-row$' \
  tests/shell-stress/invocation-modes/holdout.test.ts >"$RUN/filter-empty.tap" 2>&1
```

The singleton-consumer, negative-control, source and resource checks pass. The
prepared timed sequence uses the same event reporter on A and B to retain
machine-readable observations without changing qualified test selection:

```sh
REPORTER='data:text/javascript,export default async function* (events) { for await (const event of events) yield JSON.stringify(event) + "\n"; }'
apply_patch <"$RUN/select-A.patch"
/usr/bin/time -p "$NODE" --import tsx --test --test-concurrency=1 \
  --test-reporter="$REPORTER" tests/shell-stress/invocation-modes/holdout.test.ts >"$RUN/A1.ndjson" 2>"$RUN/A1.time"
apply_patch <"$RUN/select-B.patch"
/usr/bin/time -p "$NODE" --import tsx --test --test-concurrency=1 \
  --test-reporter="$REPORTER" tests/shell-stress/invocation-modes/holdout.test.ts >"$RUN/B1.ndjson" 2>"$RUN/B1.time"
/usr/bin/time -p "$NODE" --import tsx --test --test-concurrency=1 \
  --test-reporter="$REPORTER" tests/shell-stress/invocation-modes/holdout.test.ts >"$RUN/B2.ndjson" 2>"$RUN/B2.time"
apply_patch <"$RUN/select-A.patch"
/usr/bin/time -p "$NODE" --import tsx --test --test-concurrency=1 \
  --test-reporter="$REPORTER" tests/shell-stress/invocation-modes/holdout.test.ts >"$RUN/A2.ndjson" 2>"$RUN/A2.time"
apply_patch <"$RUN/select-B.patch"
```

Record and check each exit status before advancing; stop on a correctness
failure rather than timing a known-bad candidate. Verify A hashes against the
original caller `ba1a9c461822a81fa99193ad3aa04bf1382cf0bb567d2e4569d5f67c93ac5d02`
and child `c5d770ba6ba0522e0387fbcbdd0dd00c9437ae3520ae593aeaf1546be604781d`.
Immediately after actual checks/timings and candidate restoration, report short
results plus **CPU released**. Detailed evidence analysis and plan updates follow
without a CPU reservation. These commands are the retained preparation, not an
exact execution transcript; the actual Node wall-clock measurement and final
fresh evidence paths are documented in the final ABBA section.
