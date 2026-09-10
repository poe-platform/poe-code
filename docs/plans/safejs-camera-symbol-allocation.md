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
