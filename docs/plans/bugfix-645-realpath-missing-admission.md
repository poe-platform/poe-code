# Bugfix #645: realpath missing-path admission

## Validated scope

At a4a53ff99898ea7cb1d5f435139b6bf2e56055c4, bounded source probes show quadratic
cumulative prefix processing for realpath -m and delayed timer cancellation.
readlink -m is unsupported; realpath -e does not enter canonicalMissing.
The existing guarded missing-target resolver is used by CP preflight only.

## Implementation

- Preserve preliminary lstat, current output/error semantics, CP preflight
  dispatch, adapter refusal, and quota masking.
- Admit the existing guarded resolver for realpath -m, including relative-to
  and relative-base values. Do not change SafeFS or GNU compatibility semantics.
- Replace recursive fallback with iterative descent and exact reverse joinPath
  folding. Yield and check cancellation during descent and reconstruction for
  realpath mode only; preserve CP scheduling.
- Do not invent an arbitrary path-depth cap or claim arbitrary-host preemption.
  Fallback prefix work can remain quadratic; bounded scheduling checkpoints make
  it cooperative. The existing synchronous optimized hook is not preemptible.

## TDD and verification

First run deterministic failing owned-resolver operation-count and fallback
cancellation tests. Cover falsey reasons, pre-abort zero filesystem calls,
relative values, ENOTSUP/no fallback, undefined refusal, quota masking, output
prefixes, primary lstat errors, exact legacy folds, and a tiny native corpus.
Then run the new tests plus CP preflight #620, copy identity and filesystem
adjacent tests. Root coordinates test registration and frozen maintained gates;
do not run broad build/typecheck/lint concurrently with disjoint workers.

## Evidence

Validation artifacts and RED/GREEN logs belong to the existing isolated
issue645-bounded-a4a53ff evidence directory. No repository evidence copies,
README changes, branches, commits or publication are part of this assignment.

## Progress

- RED: 16 focused tests, 10 expected failures and 6 passing controls against the
  unchanged product source, including both missing fallback yields.
- Initial GREEN: all 46 tests passed across the new suite, CP preflight #620,
  copy identity, and filesystem commands. Added direct stock-hook refusal and
  immediate-fatal-error controls for independent review.
- Review GREEN: all 49 tests passed, with zero failures, cancellations, or skips;
  total runner duration approximately 0.85 seconds.
- Maintained lint/build/typecheck gates remain root-coordinated and pending.
