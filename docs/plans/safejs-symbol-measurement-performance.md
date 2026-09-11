# SafeJS symbol measurement allocation reduction

## Problem and bounded change

The full maintained unit run on `ac2296cf87e5a82cafdfbc954d4b87fb12b1aa39` failed only the PPR2 `co` scenario at 6,072ms against its unchanged 5,000ms deadline. An unchanged focused replay reproduced the failure at 6,186ms; the other 18 scenarios passed.

In `measureSandboxData`, replace the external-symbol `filter().map()` chain with one loop that builds the same descriptor array. Enumerate own symbols once, exclude internal symbols, read external descriptors in symbol order, and finish descriptor capture before visiting any captured values. Keep the existing guest-host-object guard and all other accounting unchanged. No branding shortcuts, memoization, timeout adjustments, or coverage reductions are introduced.

## Evidence

- Full RED: `/tmp/poe-type-contract-unit.log`. SafeJS: 21,662 passed, one failed, 37 maintained skips; no full-gate success claimed.
- Unchanged replay RED: `/tmp/poe-ppr2-unchanged-replay.log`, 18/19 passed, `co` 6,186ms. Load before 55.12/54.56/49.40, after 57.87/55.52/49.97.
- Calibrated inspector evidence: `/tmp/poe-ppr2-profile-calibrated-xje03p99/`. CPU profile and test markers use start/stop anchors because V8 and hrtime have different origins. The offset intersection was 35,829,736,918–35,829,793,961 microseconds, with 57.043ms uncertainty. The `co` interval lasted 6,786.275ms. Sampled elapsed weights showed `visit` in `values.ts` as the largest leaf hotspot (1,995ms), with GC at 607ms. Root's source-line review identified symbol descriptor collection within this visit path as a bounded allocation opportunity. These are diagnostic sample weights, not precise CPU accounting or proof that this expression alone caused the timeout.
- Focused accounting and capture validation: `/tmp/poe-symbol-single-pass-focused.log`, 126/126 tests across nine files passed in 9.83s. Coverage includes intrinsic measurement/capture, array symbol/index capture, typed-array symbol accounting, registry accounting, bookkeeping, and accessor boundaries.
- Candidate unchanged all-19 replay: `/tmp/poe-symbol-single-pass-ppr2.log`, 19/19 passed, `co` 2,230ms. Host load was lower than during RED, so the entire improvement cannot be attributed to the code change.
- One sequential A/B pair changed only this exact hunk and restored the candidate in `finally`: `/tmp/poe-symbol-loop-ab.py`. Baseline and candidate each passed all 19 scenarios. Baseline `co` 2,656ms, candidate 1,994ms; outer times 9.339s and 8.772s. Load moved from 26.78 to 25.60 during baseline and 25.60 to 24.25 during candidate. This approximately 25% difference is an observed single pair, not a controlled benchmark or a guarantee under contention. Logs: `/tmp/poe-symbol-ab-baseline.log` and `/tmp/poe-symbol-ab-candidate.log`. Both owned process groups were absent afterward.
- `git diff --check` passed. Independent review and broader maintained qualification are separate requirements before delivery.

No commit, remote delivery, or successful release is implied by these local observations.
