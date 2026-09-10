# Camera timeout investigation: symbol accounting

User priority on 2026-09-10: improve the repeatedly failing camera checks.
Releases remain on hold. Do not push main, which triggers publication.

## Validated evidence

- Main runtime is `25f9bb944`; its full package gate (session 14148) is still
  running. Keep its source and tests fixed until terminal.
- Current main camera-only rerun passed all 11 tests, with 24.612 seconds in
  tests and individual batches taking 2.272–3.391 seconds. Report:
  `/tmp/safejs-camera-current-recheck.json`.
- Object-placeholder test names truncate the case IDs, making all batch names
  identical even in JSON reports. Selecting a full batch ID ran zero tests in
  `/tmp/safejs-camera-single-recheck.json`.
- The isolated candidate uses tuple `%s` names without changing membership or
  assertions. The same selection then ran exactly the intended batch, but it
  timed out at the unchanged 5000ms limit (6401ms observed). Report:
  `/tmp/safejs-camera-names-candidate.json`. Naming is repaired in the candidate;
  camera reliability is not.
- Current built-runtime CPU profile:
  `/tmp/safejs-camera-profile-current.VFir6Q/current.cpuprofile`.
  Symbol enumeration/filter/map are prominent self-time locations in retained
  data measurement. Profile samples are not operation counts.

## Isolated candidate, not integrated

Directory: `/tmp/safejs-new-promise-capability.KGfWqD`.
This directory matched the committed settled-Promise runtime before this work.
The separate pending-Promise prototype in `/tmp/safejs-promise-depth.bKyGJi`
is paused and must not be included in camera changes.

In `values.ts`, replace symbol filter/map intermediates with a loop and a lazily
allocated descriptor list. Keep all symbol descriptors captured before visiting
any retained value: callbacks can mutate subsequent symbol properties. No
cross-measurement cache, accounting omission, budget increase, timeout increase,
or fixture reduction.

New `measure-symbol-capture.test.ts` was run before implementation:
one allocation regression failed (one filter call instead of zero); two semantic
controls passed. After implementation, all three tests and the existing ordinary
record and intrinsic retention allocation controls passed: 33 tests, three files
(terminal e4fab0). The new controls preserve exact accounting across callback
mutations and hidden symbol accessor captures without getter execution.

## Timing experiment

Diagnostic `/tmp/safejs-camera-symbol-comparison.mts` compares baseline and
candidate source runtimes, alternating order across three trials and using all
three full fixtures each time. Every execution checks both raw native results
(including signed zero) and the complete recorded JSON trace. Original source,
seed and budgets are unchanged. All 18 comparisons passed.

Aggregate process CPU: baseline 27,692.515ms; candidate 24,539.671ms, approximately
11.4% lower. Individual baseline/candidate CPU totals per trial:

| Trial | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| 0 | 9207.042 | 8420.362 |
| 1 | 9183.649 | 7977.193 |
| 2 | 9301.824 | 8142.116 |

The full package gate ran concurrently; one selected camera test also ran during
part of this experiment. Wall times are not idle-machine benchmarks. The observed
CPU improvement warrants further qualification, not a claim that CI timeouts are
fixed. An optimized camera batch still timed out under concurrent load.

## Remaining work

Isolated lint passed (619377); TypeScript passed (baee87). The broader
symbol/measurement/retention/budget selection passed all 604 tests across 53
files (4d22b3); report `/tmp/safejs-symbol-accounting-candidate.json`.

1. Retain these focused results as candidate evidence, not full qualification.
2. Collect the terminal main gate 14148 and inspect its JSON failure messages.
   Do not restart it or confuse its result with candidate qualification.
3. Repeat camera tests and timings without competing diagnostic workloads.
4. Integrate the test-name repair and qualified allocation improvement separately,
   with their own local commits and appropriate focused checks. Run the maintained
   package gate for the shared accounting change; do not claim completion from
   the narrower selection alone.
5. Continue investigating if timeout headroom remains inadequate. Preserve full
   numeric conformance coverage. No releases or pushes during the hold.

## September 10 follow-up qualification

The complete isolated camera rerun failed five of eight sandbox batches at
5000ms; all three native controls passed. Total test duration was 41.324 seconds.
Report `/tmp/safejs-camera-symbol-candidate-full.json`, terminal 7955e5. This
rules out calling the allocation candidate a sufficient timeout repair.

A second isolated directory `/tmp/safejs-camera-closure-symbols.ZXRzwR` contains
the allocation candidate plus an experimental factory-wrapper symbol exemption.
The factory freezes each wrapper, checks its own keys after host initializer
callbacks, and records only exact wrappers whose symbols are all internal in a
private WeakSet. Measurement still traverses mutable guest properties, private
slots and captures. Proxies and inherited brands are not members.

`closure-symbol-scan.test.ts` first failed its no-enumeration regression, with
four passing controls for guest-table mutation, host-added wrapper symbols,
inherited brands and native proxy traps (2e6b59). After implementation, ten
focused tests passed across three files (a9da5b). TypeScript passed (a0463e).

This is the same hypothesis previously tested and rejected in the historical
`safejs-camera-ci-performance.md` frozen-wrapper experiment. Do not treat it as
a novel discovery or integrate it merely because focused tests pass. The fresh
paired source comparison against the allocation-only candidate passed all 18
full native/recorded checks; aggregate CPU was 24,547.475ms versus 23,199.169ms
(about 5.5% lower). Trial totals were 8389.346/7858.624, 8265.843/7764.327 and
7892.286/7576.218ms. The modest additional saving needs independent confirmation
before accepting extra runtime state. The full package gate was concurrent and
a short conformance rerun overlapped part of the experiment. No source from this
experiment has been integrated into main.

The broader second-candidate accounting run 99880 passed all 609 tests across
54 files (833bb9), report `/tmp/safejs-closure-symbol-accounting-candidate.json`.
Scoped lint passed (84ae99).
The first candidate's conformance test now also contains a separate stale
RegExp expectation correction; do not bundle that test change with performance.
See `safejs-host-regexp-conformance-refresh.md`.

A fresh process reversed the comparison order and again preserved all 18 full
traces (fd2c6e). Allocation-only CPU total was 25,756.681ms; the frozen-wrapper
candidate used 25,087.486ms, only about 2.6% lower. Individual paired executions
include regressions. Defer the extra WeakSet optimization: the small and varying
additional gain does not yet justify adopting this previously rejected approach.
Keep its isolated directory as experimental evidence, not a qualified source for
main integration. The simpler allocation-only candidate remains the next runtime
change to qualify.

A related direct-root symbol-accounting discrepancy was investigated without a
runtime change; the attempted public bypass was rejected at replay admission.
See `safejs-intrinsic-symbol-accounting-audit.md`. The speculative failing tests
were removed from the allocation candidate, with the probe preserved separately.

Independent allocation-only confirmation reversed the original ordering in a
fresh process. All 18 complete native/recorded checks passed (7c9359).
Baseline CPU was 28,467.542ms; candidate CPU was 24,757.196ms (about 13% lower).
This corroborates the original 11.4% result. Wall times were highly contended;
one candidate run took 14,848.645ms elapsed but 3522.555ms process CPU. Do not
claim a stable wall-clock timeout fix from these measurements.

The native-only naming selection passed all three selected tests (ea80cb).
Its JSON report contains all 11 unique, untruncated test names (1d4933);
the eight sandbox cases were intentionally skipped in that naming-only check.
Report `/tmp/safejs-camera-native-names-qualification.json`. Earlier full-file
and selected-batch timing failures remain relevant.

## Main integration after the baseline gate

Gate 14148 ended before main runtime/test integration. The new main allocation
regression first failed with one filter call (953694); its two semantic controls
passed. The main runtime change now byte-matches the qualified allocation-only
candidate (f061ac). No frozen-wrapper exemption was imported.

Focused main integration (90167, terminal 175520) ran with one worker: 714 passed,
four failed across 58 files. All 11 camera tests passed, with sandbox batches
2080–3565ms and 22.634 seconds for the file. The accounting selection passed.
The four failures are three newly exposed async-host nested-Promise replay hangs
and the unchanged 128-draw completed-replay timing case; neither is dismissed as
irrelevant. See safejs-completed-promise-expectation-refresh.md for the confirmed
hang. Report `/tmp/safejs-camera-main-integration-focused.json`.

Main scoped lint and the maintained build remain required before the runtime
commit. A fresh full package gate is still required; this focused result does
not establish that full-suite camera timeouts are resolved.

Main scoped ESLint subsequently passed for values.ts, the new allocation guards
and camera test names (2ff34e). The maintained workspace build is the remaining
pre-commit check for the allocation change.

Maintained build started as session 72722 with
`npm run build:workspaces -- --workspace=@poe-code/safe-js` (a26eb3).
Keep source fixed while it runs and collect its terminal result before claiming
build success. After that, commit only values.ts, measure-symbol-capture.test.ts
and this plan for the runtime optimization. The camera naming and RegExp test
corrections have separate commits; the completed-Promise test remains a failing
regression for a real replay scheduling bug.

The maintained build completed successfully (b9eebb): 23 declared workspace
builds and all five fresh-process built-import checks passed. Scoped lint and
focused accounting/camera evidence above qualify this local allocation commit.
No full-package-green or CI timeout-resolution claim is made. The next full gate
should include the actual async-host Promise replay repair rather than repeatedly
rerunning a known hanging regression without a code change.
