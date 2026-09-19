# Independent csvstat metrics review

Use a different agent to exercise the actual registered safe-bash command with
in-memory stdin and MemoryFileSystem. Product commands and canonical tests must
not spawn native programs or use network, database services or host files.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvstat-metrics-review.test.ts`.
2. Require exact stdout, stderr and exit status for all 241 primary frozen
   observations and all 19 sensitive numeric/Unicode/temporal observations.
   Require no VFS filesystem effects for stdin metrics. Dispose each shell.
3. Run focused ESLint for the new test. Root owns maintained discovery
   registration, integration/build checks and Git operations.
4. Audit original csvkit OPERATIONS and Agate aggregation type validation using
   the hash-pinned source archives. Verify numerical calculations before proposing
   a production change. Unmeasured cases remain blockers.

Outcome: all 263 shell tests pass, with zero skips or TODOs; focused ESLint passes.
These exact captured-output comparisons use no numerical tolerance. They cover
Decimal cancellation, very small/large magnitudes, precision bounds, sample
stdev, nulls, first-appearance frequency ties, negative/zero frequency-count
behavior, Boolean metric exclusion, type labels and distinct serializers.
Arbitrary locale formatting, new numeric inputs outside the captured reference,
database behavior and the full command suite remain outside this review.

Research-only network reads inspected csvkit 2.2.0 source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`
and Agate 1.14.2 source archive SHA-256
`7f29841c39d84b1de7fde762b8d792085371515324f3a01413b20f810398225b`.
Both hashes were verified before archive member inspection. Archive bytes and
source inspection stayed in memory; no downloaded files were retained.

Source audit confirms Number.cast multiplies the parsed Decimal by its sign,
rounding at the frozen precision-28 context before aggregation. Two exploratory
tests expecting distinct raw inputs beyond 28 digits failed, but their expected
outputs were invalid for that cast. They were removed after source verification;
they do not establish a product defect. Frozen input
`9999999999999999999999999999` / `10000000000000000000000000001`
with captured stdev `1.0` independently confirms the cast behavior.

Agate Median delegates to Percentiles and selects index 50; its CDF method
reduces to the middle value or average of the two middle values. Variance uses
the mean and sum of squared differences divided by n-1. Min/Max accept Number,
Date, DateTime and TimeDelta; Sum/Mean accept Number and TimeDelta. Boolean is
excluded from these numerical aggregations. Existing implementation agrees with
these inspected rules for the reviewed cases.

Follow-up research recreated the exact frozen CPython 3.14.2 binary (verified
SHA-256 `3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`)
with dependencies installed using the maintained requirement lock and
`--require-hashes`, under an owned temporary out directory. C/UTC original
measurements are persisted in docs/csvkit/csvstat-metrics-review-reference.json.
Three fresh CLI cases pass exactly: median with three negative and two positive
infinities returns None because another percentile boundary traps; two negative
and one positive infinity retains median -Infinity; zero sample stdev is zero.
The first case validates the root fix to compute every source percentile before
selecting the median. Eight independent full 101-percentile and sample variance
comparisons pass exactly, including the root zero-squared-difference fix.

An independent deterministic 10,000-input original Decimal square review (seed
20260918) found five cases where CPython `difference ** 2` differs from exact
`difference * difference` by one unit in the last precision-28 digit. All five
inputs and original square, variance, stdev and JSON observations are persisted.
For symmetric pairs, four sample variances differ by two units in the last
precision-28 digit after accumulation. These are exact-value compatibility
blockers, never passing comparisons. One-unit square/two-unit variance error is
an observed cohort bound only; it is not an all-input guarantee or permission to
claim exact formatter/value parity. No canonical test weakens exact comparison
to turn these mismatches into passes. The eight passing metrics comparisons and
263 passing shell cases do not resolve this broader blocker.
