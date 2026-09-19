# Decimal metrics validation

The domain command now uses Agate's complete CDF percentile calculation for
median and a dedicated ordered Decimal sample-variance implementation for stdev.
The fourteen executable registrations and argv grammar are unchanged. No product
subprocess, host filesystem, network or database capability was added.

The original n=5 infinity regression first failed: direct-middle median produced
`-Infinity\n`, while the frozen CPython/Agate original produces `None\n`.
Computing all source percentiles preserves the trap at percentile 60. The n=3
countercase remains `-Infinity\n`. Independent original numerical QA also
reproduced variance `0.0000` instead of `0` for Decimal zero differences. Squared
finite zero now uses Python power's preferred exponent zero.

Canonical inputs stay in memory. Twelve primitive tests include eight exact
full-101-percentile/variance original comparisons, cancellation, NaN, empty and
singleton behavior and fractional increments above binary64 integer resolution.
A different agent verified 263 exact registered-shell original cases, including
all previously frozen numerically sensitive observations, and absence of VFS
effects. Source/profile hashes and new observations are retained in
csvstat-metrics-review-reference.json.

The existing operation/type matrix, first-occurrence Counter frequency ties,
null membership, zero/negative frequency limits, codepoint length, MaxPrecision,
finite/nonfinite handling, labels and distinct serializers remain covered by
the frozen command cases. No numeric value is rounded to three decimal places
before calculation. Injected formatting is applied only during serialization.

Exact nonzero Decimal power compatibility remains an explicit blocker. Five
of 10,000 independently sampled CPython squares differ from multiplication by
one precision-28 last-place digit; four symmetric-pair variances differ by two.
These are recorded discrepancies, not passing exact comparisons. The observed
error bound is not an all-input tolerance guarantee. Existing arithmetic exponent
admission, unqualified locale hosts and full-suite capability blockers remain.

Maintained discovery checks pass all 109 cases; the new independent test is
registered by literal path. Focused Shell tests pass 545 cases before the three
new original regressions, and the independent final suite passes all 263.
Domain lint/source/test typing and selected domain/safe-bash build closures pass.
The built registered Number report was captured with the repository screenshot
utility and inspected: labels, null annotation, frequency continuations and row
count render correctly. An initial screenshot used an unmeasured formatter input
and failed; only the subsequent captured-reference input is credited.

An initial safe-bash full typecheck timed out in its maintained historical type
model phase. Domain test reruns also encountered changing 5-second timeouts in
unrelated fast cases under observed host CPU contention. These failed executions
are not gate passes; final rerun outcomes are recorded below. No timeout limits
or tests were weakened. No README, index, commit, push or release changes.

Final maintained domain rerun (`npm test --workspace=@poe-code/csvkit --
--maxWorkers=1`) passes 2,620 tests in 48 files. The existing one skip and six
TODOs remain unqualified. All cases that timed out in earlier executions pass
without timeout changes; the final run completes in 7.5 seconds.

Final safe-bash maintained typecheck passes source/tests, four source consumer
groups and all 26 current public-consumer groups; declared negative fixtures
are rejected as expected. Focused final ESLint passes. Only this review's newly
acquired out evidence was purged after recording results and viewing the image.

Subsequent final edge review resolves the nonzero square/variance blocker recorded
above. CPython's precision-31 working square followed by precision-28 final
rounding now matches every original discrepancy exactly. The original captures
remain unchanged. Current checks and independent sampling results are recorded
in csvstat-final-metrics-validation.md and csvstat-final-edge-validation.md;
extreme exponent admission and the other suite capability limits remain explicit.
